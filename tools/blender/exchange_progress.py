"""Emit measured, throttled progress for the current Blender exchange stage."""
import json
import time

_last_message = None
_last_time = 0.0


def report(message, done=None, total=None, unit='frames'):
    global _last_message, _last_time
    now = time.monotonic()
    if message == _last_message and done != total and now - _last_time < 0.5:
        return
    _last_message, _last_time = message, now
    print('SH3_PROGRESS_JSON ' + json.dumps(dict(message=message, done=done, total=total, unit=unit)), flush=True)


def frames(first, last, message):
    total = last - first + 1
    for index, frame in enumerate(range(first, last + 1)):
        report(message, index, total)
        yield frame
    report(message, total, total)
