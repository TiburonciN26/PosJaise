# Cierre de Fase 5 · ACL y paquete

Fecha: 2026-10-11, America/Lima. Base HEAD 6929c619. Complementa VERIFICACION-FASE5-LISTAS-ADMIN-V3.md, sin sustituir ni sobrescribir su evidencia histórica.

**Se mantiene la aprobación con observaciones, únicamente local.** La discrepancia de permisos de la utilidad SQL queda cerrada.

## Comprobaciones nuevas

- La migración revoca ahora EXECUTE de public y anon para normalizar_busqueda(text), y mantiene authenticated.
- En la base Local, has_function_privilege devuelve false para anon y true para authenticated. La función sigue siendo invoker (prosecdef=false).
- La llamada real SIN sesión a la RPC pura, usando la constante ficticia María NFD, devuelve HTTP 401 / código 42501, sin resultado. La respuesta 200 documentada en V3 corresponde al estado anterior y queda como histórico.
- PAQUETE-FASE5-ARCHIVOS.md y el parche inverso enumeran los mismos 13 archivos modificados por Fase 5. Los nuevos y las secciones 47/48 del changelog están separados de Fases 3/4.
- git apply -R --check del parche pasa; no se aplicó.
- La fila 5 del registro refleja correctamente aprobación solo local, los veredictos y los límites pendientes.

No se repitió la consulta con sesión de administradora que informó Claude (985 resultados). La comprobación independiente de esta ronda acredita el grant conservado, la denegación anónima y la correspondencia de la migración. No se atribuye una lectura como postgres a una prueba de RLS con sesión admin.

## Antes de una publicación futura

La lista es un inventario, no autorización de commit ni de exposición pública de los informes. Mantener .codex y .env fuera del paquete de publicación. Resolver las dependencias de Fase 4: por ejemplo, InicioCliente importa catalogoPublico, añadido en esa fase. Validar el estado integrado/commit exacto en un checkout limpio; no asumir que un commit aislado de Fase 5 compila sobre HEAD si Fase 4 no está incluida previamente.

Las migraciones …001 y …002 siguen siendo locales. Prepararlas/verificarlas por separado para el backend aprobado de staging cuando el usuario autorice ese paso. No aplicar nada al Supabase del negocio por esta aprobación.

Se conservan las observaciones Unicode, costo SQL/RLS para Fase 7 y falta de matriz real cajera/asistente/staging/producción. No hace falta repetir toda la suite por el cambio acotado de ACL; la utilidad sigue conservando EXECUTE para authenticated.

## Estado

Sin cambios de código, configuración, datos, esquema, Git o hosting por Codex. Solo lectura y reportes nuevos de QA. La Fase 6 no se inició; espera indicación del usuario conforme a la guía.
