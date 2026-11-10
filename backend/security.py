import asyncio, ipaddress, socket
from urllib.parse import urlsplit, urlunsplit
import httpx

class SafeError(Exception):
    pass

def endpoint(url: str):
    p = urlsplit(url)
    if p.scheme != 'https' or not p.hostname or p.username or p.password or p.fragment or p.query or p.port not in (None, 443):
        raise SafeError('Use an HTTPS endpoint on port 443 without credentials, query, or fragment.')
    return p

async def public_addresses(host):
    try:
        records = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        ips = sorted({r[4][0] for r in records})
    except OSError:
        raise SafeError('Destination DNS lookup failed.') from None
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        raise SafeError('Private, loopback, and internal destinations are forbidden.')
    return ips

async def public_request(method, url, **kwargs):
    # Pin the validated address; retain hostname for TLS certificate verification.
    p = endpoint(url)
    ips = await public_addresses(p.hostname)
    host = f'[{ips[0]}]' if ':' in ips[0] else ips[0]
    pinned = urlunsplit((p.scheme, host, p.path, '', ''))
    headers = dict(kwargs.pop('headers', {}), Host=p.hostname)
    async with httpx.AsyncClient(trust_env=False, follow_redirects=False, timeout=60) as client:
        async with client.stream(method, pinned, headers=headers, extensions={'sni_hostname':p.hostname}, **kwargs) as response:
            if 300 <= response.status_code < 400:
                raise SafeError('Redirects are not permitted. Configure the final HTTPS destination.')
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 50 * 1024 * 1024:
                    raise SafeError('Response exceeds the 50 MB limit.')
            return httpx.Response(response.status_code, content=bytes(data), headers=response.headers)

def provider_error(response):
    if response.is_success:
        return
    # Never expose provider bodies: they can echo credentials, prompts, or media.
    status = response.status_code
    if status in (401,403): message = 'Invalid credentials or provider permission denied.'
    elif status == 402: message = 'Insufficient credits. Check your provider account.'
    elif status == 429:
        body = response.text.lower()
        message = 'Insufficient credits. Check your provider account.' if any(s in body for s in ['quota','credit','balance']) else 'Rate limited. Wait and retry.'
    elif status in (400,404,422): message = 'Unavailable model or voice, or unsupported request. Check settings.'
    else: message = 'Provider unavailable. Retry later.'
    raise SafeError(message)
