import asyncio, json, hashlib, wave
from pathlib import Path
from .security import SafeError

async def command(*args):
    p=await asyncio.create_subprocess_exec(*map(str,args),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
    try:
        out,err=await asyncio.wait_for(p.communicate(),90)
    except BaseException:
        p.kill(); await p.wait(); raise
    if p.returncode: raise SafeError('Media processing failed. Use a valid non-DRM media file.')
    return out

async def duration(path):
    out=await command('ffprobe','-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,wav,mp3,ogg,aac,flac','-show_entries','format=duration','-of','json',path)
    return float(json.loads(out)['format']['duration'])

async def extract(source,dest):
    await command('ffmpeg','-v','error','-y','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,wav,mp3,ogg,aac,flac','-i',source,'-vn','-ac','1','-ar','16000',dest)

def cache_identity(source,language,settings):
    return hashlib.sha256(json.dumps({'source':source,'language':language,'settings':settings,'pipeline':1},sort_keys=True).encode()).hexdigest()

def validate_segments(segments,total):
    if not segments or len(segments)>500: raise SafeError('No usable captions or too many segments.')
    previous=0
    for s in segments:
        if not (previous<=s['start']<s['end']<=total+0.05) or not s['source'].strip():
            raise SafeError('Captions must be ordered, non-overlapping, and within the video timeline.')
        previous=s['end']

async def align(segments,total,folder):
    rate=24000
    output=bytearray(round(total*rate)*2)
    for i,s in enumerate(segments):
        available=(segments[i+1]['start'] if i+1<len(segments) else total)-s['start']
        actual=await duration(folder/f'{i}.mp3')
        s['audio_duration']=actual
        speed=max(1,actual/available)
        if speed>1.25: raise SafeError(f'Timing issue in segment {i+1}: speech cannot fit within 1.25× speed.')
        target=folder/f'{i}.wav'
        await command('ffmpeg','-v','error','-y','-i',folder/f'{i}.mp3','-af',f'atempo={speed}','-ac','1','-ar',rate,target)
        with wave.open(str(target),'rb') as w: data=w.readframes(w.getnframes())
        start=round(s['start']*rate)*2
        if len(data)>round(available*rate)*2+int(.03*rate)*2: raise SafeError('Aligned speech exceeds its interval.')
        if start+len(data)>len(output): raise SafeError('Aligned speech exceeds the video duration.')
        output[start:start+len(data)]=data
        s['alignment']='stretched' if speed>1 else 'padded'
    with wave.open(str(folder/'track.wav'),'wb') as w:
        w.setparams((1,2,rate,0,'NONE','not compressed')); w.writeframes(output)
