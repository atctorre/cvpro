#!/usr/bin/env python3
"""Compara los archivos devueltos por get_edge_function (JSON guardado en disco) con los .deploy locales.
Uso: python3 verificar_deploy.py <respuesta_get_edge_function.json> <carpeta_con_.deploy_e_index.ts>
Sale con código 1 si algún archivo falta, está vacío o difiere (salvo la normalización Unicode tolerada)."""
import json, sys, difflib, os
resp, base = sys.argv[1], sys.argv[2]
d = json.load(open(resp, encoding="utf-8"))
esperados = {"index.ts": "generar-cv.ts", "validador.mjs": "validador.mjs.deploy",
             "lexico.mjs": "lexico.mjs.deploy", "serializar.mjs": "serializar.mjs.deploy"}
norm = lambda s: s.replace("[̀-ͯ]", "[\\u0300-\\u036f]")
remotos = {f["name"]: f["content"] for f in d.get("files", [])}
ok = True
print(f"version {d.get('version')}  sha {d.get('ezbr_sha256')}")
for nombre, local in esperados.items():
    if nombre not in remotos:
        print(f"FALTA {nombre}"); ok = False; continue
    r = remotos[nombre]
    p = os.path.join(base, local)
    if not os.path.exists(p): p = os.path.join(base, nombre)
    l = open(p, encoding="utf-8").read()
    if not r.strip():
        print(f"VACÍO {nombre}"); ok = False; continue
    if norm(r) == norm(l):
        print(f"OK    {nombre} ({len(r)} chars)")
    else:
        ok = False
        print(f"DIFF  {nombre} remoto={len(r)} local={len(l)}")
        sm = difflib.SequenceMatcher(None, norm(l), norm(r), autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag != "equal":
                print("   ", tag, repr(norm(l)[max(0,i1-30):i2+30]), "=>", repr(norm(r)[max(0,j1-30):j2+30]))
sys.exit(0 if ok else 1)
