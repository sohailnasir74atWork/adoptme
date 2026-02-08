import json
import os

langs = ['ar', 'de', 'es', 'fr']
base_path = '/Volumes/Sohail/AI_Projects/adoptme-jan7/Code/Translation'

with open(os.path.join(base_path, 'en.json'), 'r') as f:
    en_data = json.load(f)

def find_missing(source, target, path=''):
    missing = {}
    for k, v in source.items():
        current_path = f"{path}.{k}" if path else k
        if k not in target:
            missing[current_path] = v
        elif isinstance(v, dict) and isinstance(target[k], dict):
            sub_missing = find_missing(v, target[k], current_path)
            if sub_missing:
                missing.update(sub_missing)
    return missing

for lang in langs:
    target_path = os.path.join(base_path, f'{lang}.json')
    if os.path.exists(target_path):
        with open(target_path, 'r') as f:
            target_data = json.load(f)
        
        missing = find_missing(en_data, target_data)
        with open(os.path.join(base_path, f'missing_{lang}.json'), 'w') as out:
            json.dump(missing, out, indent=2, ensure_ascii=False)

