import asyncio, json, uuid, hashlib, shutil, os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, ValidationError
from .providers import Settings, Credentials, validate, key_for, transcribe, translate, synthesize, tone
from .media import duration, extract, align, cache_identity, validate_segments
from .security import SafeError, public_request

ROOT=Path(__file__).resolve().parent.parent
DATA=Path(os.getenv('DATA_DIR',str(ROOT/'.data'))); DATA.mkdir(exist_ok=True)
tasks={}; gate=asyncio.Semaphore(2)

class JobInput(BaseModel):
    settings: Settings
    credentials: Credentials = Field(default_factory=Credentials)
    source: str = ''
    fixture: bool = False
    language: str = Field(default='Simplified Chinese',max_length=80)
    duration: float = Field(gt=0,le=600)
    captions: list[dict] = Field(default_factory=list,max_length=500)
    file_confirmed: bool = False

@asynccontextmanager
async def lifespan(app):
    for path in DATA.glob('*/job.json'):
        j=json.loads(path.read_text())
        if j['status'] not in ('ready','failed','cancelled'):
            j.update(status='failed',error='Backend restarted. Provide credentials again and retry.'); path.write_text(json.dumps(j))
            for temporary in path.parent.iterdir():
                if temporary.name!='job.json': temporary.unlink(missing_ok=True)
    yield
    for task in list(tasks.values()): task.cancel()
    await asyncio.gather(*list(tasks.values()),return_exceptions=True)

app=FastAPI(lifespan=lifespan)

@app.middleware('http')
async def origin_guard(request:Request,call_next):
    origin=request.headers.get('origin','')
    if origin and not origin.startswith('chrome-extension://'):
        return JSONResponse({'detail':'Only extension requests are accepted.'},403)
    if request.headers.get('content-length') and int(request.headers['content-length'])>55*1024*1024:
        return JSONResponse({'detail':'Upload exceeds 50 MB.'},413)
    return await call_next(request)

@app.exception_handler(SafeError)
async def safe_error(request,exc): return JSONResponse({'detail':str(exc)},400)

@app.exception_handler(RequestValidationError)
@app.exception_handler(ValidationError)
async def invalid(request,exc): return JSONResponse({'detail':'Invalid settings or job request.'},422)

def read_job(id):
    if len(id)!=32 or not all(c in '0123456789abcdef' for c in id): raise HTTPException(404)
    path=DATA/id/'job.json'
    if not path.exists(): raise HTTPException(404)
    return json.loads(path.read_text())

def save(id,**changes):
    j=read_job(id); j.update(changes)
    p=DATA/id/'job.tmp'; p.write_text(json.dumps(j)); p.replace(DATA/id/'job.json')

async def process(id,job):
    folder=DATA/id
    try:
      async with gate:
        save(id,status='acquiring audio')
        source=folder/'source'
        if job.fixture:
            if not job.settings.mock: raise SafeError('Fixture is available only in explicit mock mode.')
            shutil.copy(ROOT/'demo/sample.mp4',source)
        elif not source.exists():
            r=await public_request('GET',job.source)
            if not r.is_success: raise SafeError('Source download failed. Try a matching local file.')
            source.write_bytes(r.content)
        total=await duration(source)
        if total>600 or abs(total-job.duration)>max(.5,job.duration*.02): raise SafeError('Source duration does not match the selected video (2% or 0.5s tolerance).')
        identity=cache_identity(hashlib.sha256(source.read_bytes()).hexdigest()+hashlib.sha256(json.dumps(job.captions,sort_keys=True).encode()).hexdigest(),job.language,job.settings.model_dump())
        save(id,cache_identity=identity)
        # Cache is scoped to this private local backend; no credentials enter its identity.
        for p in DATA.glob('*/job.json'):
            old=json.loads(p.read_text())
            if old.get('cache_identity')==identity and old['status']=='ready':
                shutil.copy(p.parent/'track.wav',folder/'track.wav')
                save(id,status='ready',segments=old['segments'],cached=True); return
        await extract(source,folder/'source.wav')
        save(id,status='transcribing')
        if job.settings.mock:
            segments=[{'id':'0','start':1.,'end':3.,'source':'Demo tone, not translated speech.'},{'id':'1','start':4.,'end':6.,'source':'Second demo tone.'}]
        elif job.captions: segments=[{k:s[k] for k in ('id','start','end','source')} for s in job.captions]
        else: segments=await transcribe(job.settings.speech,key_for(job.settings,job.credentials,'speech'),folder/'source.wav')
        validate_segments(segments,total)
        context=' '.join(s['source'] for s in segments)
        for i,s in enumerate(segments):
            save(id,status='translating',completed=i,total=len(segments))
            s['translated']='[MOCK] '+s['source'] if job.settings.mock else await translate(job.settings.translation,key_for(job.settings,job.credentials,'translation'),s['source'],job.language,context)
            save(id,status='generating speech')
            if job.settings.mock: tone(folder/f'{i}.mp3')
            else:
                await synthesize(job.settings.tts,key_for(job.settings,job.credentials,'tts'),s['translated'],folder/f'{i}.mp3')
                available=(segments[i+1]['start'] if i+1<len(segments) else total)-s['start']
                if await duration(folder/f'{i}.mp3')>available*1.25:
                    s['translated']=await translate(job.settings.translation,key_for(job.settings,job.credentials,'translation'),s['source'],job.language,context,True)
                    await synthesize(job.settings.tts,key_for(job.settings,job.credentials,'tts'),s['translated'],folder/f'{i}.mp3')
        save(id,status='aligning audio')
        await align(segments,total,folder)
        save(id,status='ready',segments=segments)
    except asyncio.CancelledError: save(id,status='cancelled')
    except SafeError as e: save(id,status='failed',error=str(e))
    except Exception: save(id,status='failed',error='Processing failed. Check source media and provider configuration.')
    finally:
        job.credentials=Credentials()
        for p in folder.iterdir():
            if p.name not in ('job.json','track.wav'): p.unlink(missing_ok=True)
        tasks.pop(id,None)

@app.get('/health')
async def health(): return {'status':'ok'}

@app.post('/jobs')
async def create(payload: str=Form(...), file: UploadFile|None=File(None)):
    try: job=JobInput.model_validate_json(payload)
    except Exception: raise SafeError('Invalid job settings.') from None
    validate(job.settings)
    if not job.settings.mock:
        for stage in ('translation','tts')+(() if job.captions else ('speech',)): key_for(job.settings,job.credentials,stage)
    if len(tasks)>=8: raise SafeError('Queue is full. Retry later.')
    if file and not job.file_confirmed: raise SafeError('Confirm that the file matches the selected video.')
    id=uuid.uuid4().hex; folder=DATA/id; folder.mkdir()
    if file:
        data=await file.read(50*1024*1024+1)
        if len(data)>50*1024*1024: shutil.rmtree(folder); raise SafeError('File exceeds 50 MB.')
        (folder/'source').write_bytes(data)
    record={'id':id,'status':'queued','settings':job.settings.model_dump(),'language':job.language,'mock':job.settings.mock}
    (folder/'job.json').write_text(json.dumps(record))
    tasks[id]=asyncio.create_task(process(id,job))
    return record

@app.get('/jobs/{id}')
async def status(id:str): return read_job(id)

@app.post('/jobs/{id}/cancel')
async def cancel(id:str):
    read_job(id)
    if id in tasks:
        task=tasks[id]; task.cancel(); await asyncio.gather(task,return_exceptions=True)
        save(id,status='cancelled')
        for p in (DATA/id).iterdir():
            if p.name!='job.json': p.unlink(missing_ok=True)
    return {'status':'cancellation requested'}

@app.get('/jobs/{id}/audio')
async def audio(id:str):
    if read_job(id)['status']!='ready': raise HTTPException(409)
    return FileResponse(DATA/id/'track.wav',media_type='audio/wav')

class TestInput(BaseModel):
    settings: Settings
    credentials: Credentials
    stage: str

@app.post('/test')
async def test_connection(data:TestInput):
    validate(data.settings)
    if data.stage not in ('speech','translation','tts'): raise SafeError('Unknown stage.')
    s=getattr(data.settings,data.stage); key=key_for(data.settings,data.credentials,data.stage)
    folder=DATA/uuid.uuid4().hex; folder.mkdir()
    try:
        if data.stage=='speech':
            tone(folder/'test.wav'); await transcribe(s,key,folder/'test.wav')
        elif data.stage=='translation': await translate(s,key,'Hello','Simplified Chinese','Connection test')
        else: await synthesize(s,key,'Hello',folder/'test.mp3'); await duration(folder/'test.mp3')
        return {'message':'Connection and selected model succeeded. Test usage may be billed.'}
    finally:
        data.credentials=Credentials(); shutil.rmtree(folder)

app.mount('/demo',StaticFiles(directory=ROOT/'demo',html=True),name='demo')
