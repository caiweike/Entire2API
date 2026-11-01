"""Real SDK checks against a running local gateway; reuses one paid job.

Install requirements-test.txt into .tools/sdk-current first. The API key is read locally
and is never printed. Changing --idempotency-key intentionally permits a new job.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path('.tools/sdk-current').resolve()))
import openai
import anthropic
import httpx2

parser = argparse.ArgumentParser()
parser.add_argument('--idempotency-key', default='sdk-smoke-v1')
parser.add_argument('--base-url', default='http://127.0.0.1:8080')
args = parser.parse_args()
key = Path('.local/gateway-key.txt').read_text().strip()
headers = {'Idempotency-Key': args.idempotency_key}
messages = [{'role': 'user', 'content': 'Reply with exactly ENTIRE2API_OK.'}]
model = 'entire-codex'
checks = []
run_ids = []

with openai.OpenAI(api_key=key, base_url=args.base_url + '/v1', timeout=300, max_retries=0, http_client=openai.DefaultHttpxClient(trust_env=False)) as client:
    raw = client.chat.completions.with_raw_response.create(model=model, messages=messages, max_tokens=32, extra_headers=headers)
    run_ids.append(raw.headers.get('x-entire-run-id'))
    assert raw.parse().choices[0].message.content == 'ENTIRE2API_OK'
    checks.append('OpenAI Chat Completions JSON')
    stream = client.chat.completions.create(model=model, messages=messages, max_tokens=32, stream=True, stream_options={'include_usage': True}, extra_headers=headers)
    chunks = list(stream)
    assert ''.join((c.choices[0].delta.content or '') for c in chunks if c.choices) == 'ENTIRE2API_OK'
    assert any(c.choices and c.choices[0].finish_reason == 'stop' for c in chunks)
    assert chunks[-1].usage is not None
    checks.append('OpenAI Chat Completions SSE')
    raw = client.responses.with_raw_response.create(model=model, input=messages[0]['content'], max_output_tokens=32, extra_headers=headers)
    run_ids.append(raw.headers.get('x-entire-run-id'))
    assert raw.parse().output_text == 'ENTIRE2API_OK'
    checks.append('OpenAI Responses JSON')
    with client.responses.stream(model=model, input=messages[0]['content'], max_output_tokens=32, extra_headers=headers) as stream:
        response = stream.get_final_response()
    assert response.output_text == 'ENTIRE2API_OK' and response.status == 'completed'
    checks.append('OpenAI Responses SSE accumulator')

with anthropic.Anthropic(api_key=key, base_url=args.base_url, timeout=300, max_retries=0, http_client=anthropic.DefaultHttpxClient(trust_env=False, transport=httpx2.HTTPTransport(trust_env=False))) as client:
    raw = client.messages.with_raw_response.create(model=model, messages=messages, max_tokens=32, extra_headers=headers)
    run_ids.append(raw.headers.get('x-entire-run-id'))
    message = raw.parse()
    assert message.content[0].text == 'ENTIRE2API_OK' and message.stop_reason == 'end_turn'
    checks.append('Anthropic Messages JSON')
    with client.messages.stream(model=model, messages=messages, max_tokens=32, extra_headers=headers) as stream:
        message = stream.get_final_message()
    assert message.content[0].text == 'ENTIRE2API_OK' and message.stop_reason == 'end_turn'
    checks.append('Anthropic Messages SSE accumulator')

assert len(set(run_ids)) == 1 and run_ids[0], 'The SDK checks did not reuse the same Entire run'
evidence = {'time': datetime.now(timezone.utc).isoformat(), 'openai_sdk': openai.__version__, 'anthropic_sdk': anthropic.__version__, 'checks': checks, 'run_id': run_ids[0], 'passed': True}
output = Path('.local/evidence/sdk-smoke.json')
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
print(json.dumps(evidence))
