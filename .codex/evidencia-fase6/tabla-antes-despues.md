| Ciclo | Pantallas montadas (antes→después) | Nodos al terminar (antes→después) | Máx. nodos en el ciclo | Heap tras GC MB (antes→después) | Máx. heap MB | Reposo en Ventas: temporizadores/s | rAF/s | Tarea ms/s |
|---|---|---|---|---|---|---|---|---|
| 1 | 27 → 6 | 5675 → 2600 | 4938 → 1880 | 10.14 → 7.79 | 9.88 → 7.44 | 74 → 2.2 | 0 → 0 | 13.8 → 2 |
| 2 | 27 → 6 | 26392 → 2856 | 26483 → 13016 | 24.6 → 8.97 | 24.61 → 14.37 | 78.9 → 2.2 | 0 → 0 | 12.8 → 2.7 |
| 3 | 27 → 6 | 26392 → 2856 | 26404 → 13016 | 25.05 → 9.08 | 25.11 → 14.7 | 84 → 2.5 | 0 → 0 | 12.7 → 2.1 |

Recorrido (ms, 27 rutas + Ventas): antes 9422 / 39592 / 42851 ; después 9377 / 40569 / 40970
Tareas largas (>50 ms): antes 0 ; después 1 (máx 54 ms)
