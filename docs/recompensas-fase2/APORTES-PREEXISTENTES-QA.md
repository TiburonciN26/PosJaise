# Los 17 aportes de apertura preexistentes en Supabase Local QA

Estado: **solo documentación; en QA no se borró ni se modificó nada**. Lectura de solo lectura hecha el 2026-10-05 (UTC) sobre QA.

## Qué son

`recompensas_apertura_aportes` es el mapa de aportes históricos que debe poblar **únicamente** la transición. En QA hay **17 filas** que no vienen de ninguna transición (la apertura no se ha ejecutado: 0 movimientos `APERTURA`, Recompensas apagado):

- Las 17 son de clientas `TEST F2 …` (fichas ficticias creadas por las pruebas SQL de Fase 2), cada una con cuenta web vinculada y **ninguna con movimiento de apertura**.
- Las 17 son de origen `ATENCION`, con 2 puntos antiguos → 10 monedas cada una (suma 170 monedas).
- Se crearon entre `2026-10-04 03:23:43 UTC` y `2026-10-05 03:26:00 UTC`: una por cada ejecución del caso «el servicio con aporte en la apertura no acredita otra vez…» de `tests/e2e/recompensas-fase2.test.mjs`, que inserta el aporte a mano (`insert into recompensas_apertura_aportes …`) y **no lo limpia** (la política de la suite conserva los datos de prueba).
- 16 de las 17 atenciones ya están cobradas en una venta; 1 sigue pendiente de cobro.

## Por qué importan

Con la apertura ejecutable (`recompensas_ejecutar_apertura`) estas filas **bloquean** la ejecución: una clienta por procesar con aportes preexistentes haría que el mapa no sume sus puntos antiguos. El bloqueo es intencional (en el ensayo lo detectó y rechazó la ejecución sin escribir nada).

## Identificadores

| # | aporte (id) | clienta (id · nombre) | atención (id) | monedas | creado (UTC) | atención cobrada |
|---|---|---|---|---|---|---|
| 1 | `d7fe6e5f-786b-4bcc-a92f-cc89a09398bd` | `2b455a89-adab-4841-b816-62d501697e4e` · TEST F2 mut9a2ld-f84823 | `f01fab5b-ff16-421a-b009-4104dafdbab0` | 10 | 2026-10-04 03:23:43 | sí |
| 2 | `b980a395-dce8-4152-8664-a598acf9f07f` | `5b68dc71-1484-46a0-bfe5-0bde951306da` · TEST F2 mut9bdpe-248c36 | `78c4e36e-2afc-480e-8f15-4b95a22711f9` | 10 | 2026-10-04 03:24:44 | sí |
| 3 | `648f9502-070e-402b-9c81-e2d41cbd7166` | `930f9dd8-2d9d-429e-b080-d61b8b86429a` · TEST F2 mut9e8m7-847207 | `cd841c39-94c1-44a9-8dee-7ca7b98fa025` | 10 | 2026-10-04 03:26:58 | sí |
| 4 | `a2d50b8d-f3d4-4d8d-8f55-674c402e47bc` | `d3fda355-48da-4829-ae4a-5d84e6874bed` · TEST F2 mutajj08-7b2a98 | `22d38f77-6132-417c-9777-ec461bb749df` | 10 | 2026-10-04 03:59:01 | sí |
| 5 | `25df1833-6ac7-44eb-85c2-a9ad8c37cc2c` | `10d04387-2681-4e67-97b4-7f20ad1a3560` · TEST F2 mutakqzg-2145d1 | `91919ce1-9e30-4648-be09-84be1c1eb995` | 10 | 2026-10-04 04:00:10 | sí |
| 6 | `c33fd2e8-cfbb-4bc4-9723-980c7e94e25a` | `f656526a-55a0-4100-845d-78ace241162d` · TEST F2 mutarn4c-21f571 | `cf73c4b2-c478-4c93-85c4-e896cd7f646e` | 10 | 2026-10-04 04:05:30 | sí |
| 7 | `5f171ba3-1f02-41ff-a7e5-3cb2f6da5e30` | `002a258b-7214-43e5-b680-ecf2bb94e971` · TEST F2 mutc9emb-e949af | `5650d36f-73af-401b-9826-c29767d09f99` | 10 | 2026-10-04 04:47:20 | sí |
| 8 | `d922f637-c62d-492b-928c-766ef56a20c1` | `cb182c2d-a62c-4e5a-bed1-8dd952281e5b` · TEST F2 mutdjlnu-5383ef | `d27e0cac-c85a-488c-86a6-0363def27a1b` | 10 | 2026-10-04 05:23:13 | sí |
| 9 | `d1ad813f-834c-4b2b-a89e-0a7f3e88772c` | `05f71670-938c-4cca-91a8-ee55e2562218` · TEST F2 mutfco2c-679c3d | `c9030e99-7a25-410e-8d01-76ce3ae15a96` | 10 | 2026-10-04 06:13:51 | sí |
| 10 | `b731c0db-6a5c-440c-8550-41db91682e17` | `cd549ebb-09e5-4671-8b1d-952e70d49057` · TEST F2 muu0mcnx-37fce8 | `cc1b946d-6d9d-4098-bb78-a8779eb07364` | 10 | 2026-10-04 16:08:59 | no (pendiente) |
| 11 | `e245771d-0e81-4018-99af-c0fe81d22d11` | `92590b1f-298f-445a-b5e8-6b5607a69c10` · TEST F2 muu0pm8r-014108 | `d70a2198-52af-4681-bb60-ec5daf68695b` | 10 | 2026-10-04 16:11:46 | sí |
| 12 | `a483940a-e066-49d8-a38e-4452c3f8f275` | `ff8a7e2c-23a5-4cc9-a42c-dd8927a6a009` · TEST F2 muu45v9u-c31c49 | `7eee2961-4aac-4734-b747-da875da6a4a7` | 10 | 2026-10-04 17:48:19 | sí |
| 13 | `2aeb19a4-ef0f-414b-8bad-0a9a2a05de9a` | `202b6ed3-6eba-465a-b822-7564015f7136` · TEST F2 muufn02d-462abf | `29489527-f3ab-437c-a2b2-bf27eddd0e74` | 10 | 2026-10-04 23:09:38 | sí |
| 14 | `db68beed-342c-424a-9008-784aa086a54f` | `2b1996df-9518-4427-95c7-37525ce94b8d` · TEST F2 muuheio8-085c28 | `ec79a075-083e-4403-a595-728bd5ad1ed4` | 10 | 2026-10-04 23:59:02 | sí |
| 15 | `660cf061-77f3-4462-8718-8b4ff7264f1a` | `9bab461f-0cc0-4eed-8028-642318aa2015` · TEST F2 muuif8m9-258674 | `5d182908-73cb-410c-ab1f-b7d811d8f543` | 10 | 2026-10-05 00:27:35 | sí |
| 16 | `22fe21ab-b400-4476-83d9-42b46244dd32` | `54d946ea-c316-4980-884c-3da3cb6c014a` · TEST F2 muuj92pe-38736f | `9f76257f-03cd-4eb3-9c18-21e9e9951801` | 10 | 2026-10-05 00:50:44 | sí |
| 17 | `f6d6a25e-b670-4dab-bbbb-d3b5e68de1f0` | `46f8fcc9-9268-442a-a72a-9179c0f92b31` · TEST F2 muuosq7i-88d73b | `16096e8b-f982-44e6-a42c-74c335160cb8` | 10 | 2026-10-05 03:26:00 | sí |

(Lista completa con día, puntos, estado de la atención y venta en `C:/JaiseQA-Backups/evidencia/qa-registro/aportes_17_qa.txt`; no se sube al repositorio.)

## Tratamiento propuesto para QA (requiere autorización; no ejecutado)

1. Nuevo respaldo completo (base + archivos) inmediatamente antes.
2. Verificar de nuevo que siguen siendo exactamente estas 17 filas, todas de clientas `TEST F2 %`, y que ninguna de esas clientas tiene movimiento `APERTURA`.
3. Borrarlas **por lista explícita de identificadores** (los de la tabla) en una sola transacción que compruebe `row_count = 17` y haga `rollback` si no coincide; nunca con un filtro amplio.
4. Alternativa más conservadora si se prefiere no borrar: dejar esas 17 clientas fuera de la apertura (excluirlas por nombre `TEST F2 %`). Se desaconseja: deja datos de prueba mezclados con la conversión real y complica la conciliación.
5. Para que no reaparezcan: que el caso de `recompensas-fase2.test.mjs` borre su propio aporte al terminar (cambio solo de pruebas, permitido por la excepción de la suite; **no hecho aquí** porque ese archivo escribe en QA y no se ejecutó).

Producción: no se consultó; sus datos se evaluarán aparte antes de cualquier apertura.
