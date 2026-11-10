import asyncio, json, wave
import pytest, httpx
from fastapi.testclient import TestClient
from backend import app as a
from backend.providers import Settings, Credentials, validate, request, tone
from backend.security import SafeError, endpoint, public_addresses, provider_error
from backend.media import align, cache_identity

def settings(mock=True):
 return Settings(speech={'provider':'openai','model':'whisper-1'},translation={'provider':'openai','model':'gpt-4o-mini'},tts={'provider':'fish','model':'s2.1-pro','voice':'stock'},mock=mock)

@pytest.mark.parametrize('url',['http://example.com','https://user:secret@example.com','https://example.com/?key=x','https://example.com:8080'])
def test_bad_endpoints(url):
 with pytest.raises(SafeError): endpoint(url)

@pytest.mark.asyncio
@pytest.mark.parametrize('host',['127.0.0.1','::1','169.254.169.254','10.0.0.1'])
async def test_private(host):
 with pytest.raises(SafeError): await public_addresses(host)

def test_custom_confirmation():
 s=settings();s.translation.provider='custom';s.translation.base_url='https://example.com/v1'
 with pytest.raises(SafeError): validate(s)
 s.translation.confirmed_destination=s.translation.base_url;validate(s)
 s.speech.provider='custom'
 with pytest.raises(SafeError):validate(s)

@pytest.mark.parametrize('code,body,expected',[(401,'secret','credentials'),(404,'secret','model'),(429,'rate','Rate limited'),(429,'insufficient_quota','credits'),(402,'secret','credits'),(500,'secret','unavailable')])
def test_errors_redacted(code,body,expected):
 with pytest.raises(SafeError,match=expected) as e:provider_error(httpx.Response(code,text=body))
 assert 'secret' not in str(e.value)

def test_cache():
 s=settings().model_dump();first=cache_identity('hash','zh',s)
 s['tts']['voice']='different';assert first!=cache_identity('hash','zh',s)
 assert first!=cache_identity('other','zh',settings().model_dump())
 assert 'secret' not in first

@pytest.mark.asyncio
async def test_alignment(tmp_path):
 tone(tmp_path/'0.mp3',.4)
 segments=[{'start':1.,'end':2.}];await align(segments,3,tmp_path)
 with wave.open(str(tmp_path/'track.wav')) as w:
  data=w.readframes(w.getnframes());assert w.getnframes()==72000
 assert data[:48000]==bytes(48000);assert any(data[48000:67200]);assert data[70000:]==bytes(len(data)-70000)
 assert segments[0]['alignment']=='padded'

@pytest.mark.asyncio
async def test_overlong(tmp_path):
 tone(tmp_path/'0.mp3',3)
 with pytest.raises(SafeError,match='Timing issue'):await align([{'start':0,'end':1}],1,tmp_path)

@pytest.mark.asyncio
async def test_real_adapter_user_key(monkeypatch,tmp_path):
 seen=[]
 async def post(self,url,**kwargs):
  seen.append((url,kwargs));return httpx.Response(200,json={'choices':[{'message':{'content':'你好'}}]})
 monkeypatch.setattr(httpx.AsyncClient,'post',post)
 from backend.providers import translate
 assert await translate(settings().translation,'user-supplied-key','Hello','Chinese','Hello')=='你好'
 assert seen[0][1]['headers']['Authorization']=='Bearer user-supplied-key'
 assert seen[0][0]=='https://api.openai.com/v1/chat/completions'

@pytest.mark.asyncio
async def test_jobs_and_cancellation(monkeypatch,tmp_path):
 monkeypatch.setattr(a,'DATA',tmp_path)
 id='a'*32;(tmp_path/id).mkdir();(tmp_path/id/'job.json').write_text(json.dumps({'id':id,'status':'queued'}))
 job=a.JobInput(settings=settings(),credentials=Credentials(tts='never-persist'),fixture=True,duration=8)
 await a.process(id,job)
 result=a.read_job(id);assert result['status']=='ready';assert len(result['segments'])==2
 assert 'never-persist' not in (tmp_path/id/'job.json').read_text();assert job.credentials.tts.get_secret_value()==''
 id='b'*32;(tmp_path/id).mkdir();(tmp_path/id/'job.json').write_text(json.dumps({'id':id,'status':'queued'}))
 async def delayed(*args):await asyncio.sleep(10)
 monkeypatch.setattr(a,'duration',delayed)
 task=asyncio.create_task(a.process(id,a.JobInput(settings=settings(),fixture=True,duration=8)))
 await asyncio.sleep(.02);task.cancel();await task
 assert a.read_job(id)['status']=='cancelled'

def test_validation_never_echoes_key():
 with TestClient(a.app) as client:
  response=client.post('/jobs',data={'payload':json.dumps({'credentials':{'tts':'secret-user-key'}})})
  assert response.status_code==400;assert 'secret-user-key' not in response.text

@pytest.mark.asyncio
async def test_adapters_request_contract(monkeypatch,tmp_path):
 import msgpack
 from backend.providers import synthesize,Selection
 tone(tmp_path/'tone.wav')
 captured=[]
 async def post(self,url,**kwargs):
  captured.append((url,kwargs));return httpx.Response(200,content=(tmp_path/'tone.wav').read_bytes())
 monkeypatch.setattr(httpx.AsyncClient,'post',post)
 await synthesize(Selection(provider='fish',model='s2.1-pro',voice='stock-id'),'fish-key','Hello',tmp_path/'fish.mp3')
 url,kw=captured.pop();assert url=='https://api.fish.audio/v1/tts';assert kw['headers']['model']=='s2.1-pro';assert kw['headers']['Authorization']=='Bearer fish-key';assert msgpack.unpackb(kw['content'])['reference_id']=='stock-id'
 await synthesize(Selection(provider='elevenlabs',model='eleven_multilingual_v2',voice='voice-id'),'eleven-key','Hello',tmp_path/'eleven.mp3')
 url,kw=captured.pop();assert url.endswith('/v1/text-to-speech/voice-id');assert kw['headers']['xi-api-key']=='eleven-key';assert 'Authorization' not in kw['headers']

@pytest.mark.asyncio
async def test_custom_redirect_and_pinned_dns(monkeypatch):
 import backend.security as sec
 original=httpx.AsyncClient
 seen=[]
 async def addresses(host):return ['93.184.216.34']
 async def handle(req):
  seen.append(req);return httpx.Response(302,headers={'location':'http://127.0.0.1/private'})
 monkeypatch.setattr(sec,'public_addresses',addresses)
 monkeypatch.setattr(sec.httpx,'AsyncClient',lambda **kw:original(transport=httpx.MockTransport(handle),**kw))
 with pytest.raises(SafeError,match='Redirects'):
  await sec.public_request('POST','https://custom.example/v1/chat/completions',headers={'Authorization':'Bearer custom-key'},json={})
 assert len(seen)==1;assert str(seen[0].url)=='https://93.184.216.34/v1/chat/completions';assert seen[0].headers['host']=='custom.example';assert seen[0].extensions['sni_hostname']=='custom.example'

@pytest.mark.asyncio
async def test_complete_pipeline_supplied_keys(monkeypatch,tmp_path):
 from backend.providers import tone
 monkeypatch.setattr(a,'DATA',tmp_path)
 tone(tmp_path/'tone.wav',.4);seen=[]
 async def post(self,url,**kw):
  seen.append((url,kw['headers']))
  if url.endswith('chat/completions'):return httpx.Response(200,json={'choices':[{'message':{'content':'你好'}}]})
  if url.endswith('transcriptions'):return httpx.Response(200,json={'segments':[{'start':1.,'end':3.,'text':'Hello'}]})
  return httpx.Response(200,content=(tmp_path/'tone.wav').read_bytes())
 monkeypatch.setattr(httpx.AsyncClient,'post',post)
 id='c'*32;folder=tmp_path/id;folder.mkdir();(folder/'job.json').write_text(json.dumps({'id':id,'status':'queued'}))
 import shutil
 shutil.copy(a.ROOT/'demo/sample.mp4',folder/'source')
 job=a.JobInput(settings=settings(False),credentials=Credentials(speech='asr-user-key',translation='text-user-key',tts='fish-user-key'),duration=8)
 await a.process(id,job)
 assert a.read_job(id)['status']=='ready';assert a.read_job(id)['segments'][0]['translated']=='你好'
 assert [h['Authorization'] for _,h in seen]==['Bearer asr-user-key','Bearer text-user-key','Bearer fish-user-key']
 assert 'user-key' not in (folder/'job.json').read_text()
