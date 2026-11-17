"""Strict JSON input for the offline database artifact checkers."""
import json
import math


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key: ' + key)
        result[key] = value
    return result


def _constant(value):
    raise ValueError('Non-finite JSON value: ' + value)


def _float(value):
    number = float(value)
    return number if math.isfinite(number) else _constant(value)


def load_json(source):
    return json.loads(source, object_pairs_hook=_object, parse_constant=_constant, parse_float=_float)


def self_test():
    assert load_json('{"value":[1,0.5,"NaN",null]}') == {'value': [1, 0.5, 'NaN', None]}
    for invalid in ('{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"x":{"a":1,"a":2}}', 'NaN', 'Infinity', '-Infinity', '1e9999'):
        try:
            load_json(invalid)
        except ValueError:
            continue
        raise AssertionError('Invalid artifact JSON accepted: ' + invalid)
