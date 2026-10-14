# EnvClarity — plan de desarrollo

Estado: plan propuesto, pendiente de revisión. Los pasos de implementación no están autorizados ni ejecutados por el hecho de aparecer aquí.

## Objetivo

Crear un auditor local de variables de entorno para TypeScript, Node y React con Vite. La primera entrega será una CLI fiable; después de validar su utilidad, se añadirá un visor React del informe JSON.

El alcance del producto está en `PROYECTO.md`. La configuración inicial del repositorio ya existe. Este plan continúa desde esa base; no incluye volver a inicializar Git ni conectar de nuevo el remoto.

## Un paso, un commit

1. Elegir y autorizar un único paso antes de implementar.
2. Realizar únicamente sus cambios, incluyendo las pruebas necesarias para ese comportamiento.
3. Ejecutar las comprobaciones relevantes y presentar el diff, el resultado y una forma de probarlo manualmente cuando corresponda.
4. Revisar el código y resolver los problemas encontrados dentro del mismo paso.
5. Crear el commit solo después de la aprobación explícita de la revisión. Git lo gestiona el propietario del proyecto, salvo que solicite ayuda para esa operación concreta.
6. Empezar el siguiente paso únicamente cuando el anterior esté cerrado y se autorice continuar.

Los mensajes de commit de este documento son propuestas. Se ajustarán a lo que realmente cambie. Un commit debe tener un motivo concreto y poder explicarse en una frase. No mezclar refactorizaciones, cambios visuales y comportamiento nuevo por conveniencia.

Si un paso resulta demasiado grande, dividirlo antes de implementarlo y acordar el nuevo orden. Si no necesita cambios, marcarlo como comprobado sin fabricar un commit vacío. Los fallos descubiertos durante una revisión se corrigen antes de cerrar ese paso; los problemas nuevos de validación se convierten en pasos adicionales acotados.

## Decisiones del MVP

- Node 24, TypeScript, ESM y pnpm.
- Un proyecto y un archivo de entorno seleccionado explícitamente por análisis.
- Extracción sintáctica de referencias directas; no ejecutar el proyecto auditado.
- `.env.example` define los nombres esperados inicialmente. No inferir obligatoriedad solo porque una variable se use.
- Valores de entorno limitados a la capa de lectura; el motor y los informes reciben nombres y estados de presencia o vacío.
- Informes deterministas, versionados y sin valores ni fragmentos de código.
- Sin cuentas, base de datos, telemetría, servicio remoto ni correcciones automáticas de archivos.
- Dependencias de producción nuevas requieren autorización antes de instalarlas.
- Los comandos previstos solo se ejecutarán cuando existan en `package.json`; ningún paso presupone scripts ya configurados.

## Arquitectura prevista

```text
src/
  cli.ts
  audit.ts
  core/
    types.ts
    analyze.ts
    compare.ts
    report.ts
  io/
    discover.ts
    read-env.ts
  reporters/
    text.ts
    json.ts
test/
  fixtures/
```

El motor no lee el disco ni imprime resultados. `audit.ts` coordina la lectura y las reglas. Los reporters consumen el informe. La CLI interpreta argumentos y códigos de salida. Se crearán módulos cuando los necesite su paso, sin rellenar el árbol con archivos vacíos.

La estructura del visor se decidirá al llegar a la segunda entrega. Debe reutilizar el contrato del informe y mantener fuera del navegador los módulos de lectura y el compilador TypeScript.

## Entrega 1 — CLI

### Paso 0 — cerrar el alcance y el plan

- **Cambios:** revisar este documento y precisar el ejemplo de `PROYECTO.md`: una variable usada sin documentar genera una advertencia; una variable documentada pero ausente genera un error. Acordar el recorrido y el mecanismo de revisión.
- **Comprobación:** el ejemplo, la tabla de incidencias y los criterios de aceptación describen el mismo comportamiento. Todavía no hay implementación del auditor.
- **Commit propuesto:** `docs: clarify the audit scope and development plan`.

### Paso 1 — preparar TypeScript y la compilación

- **Cambios:** configurar TypeScript estricto y ESM; incorporar las dependencias de desarrollo necesarias; definir los scripts reales de compilación y comprobación de tipos. Crear una entrada CLI mínima con ayuda, sin anunciar un análisis que todavía no existe.
- **Comprobación:** compilar y comprobar tipos con pnpm; ejecutar la ayuda de la entrada compilada; confirmar que no se lee ningún proyecto ni archivo de entorno.
- **Commit propuesto:** `chore: configure TypeScript and the CLI entry point`.

### Paso 2 — preparar pruebas ejecutables

- **Cambios:** configurar `node:test` y el script de pruebas; decidir cómo ejecutar los tests TypeScript de forma reproducible. Añadir una prueba de la ayuda y de argumentos no admitidos de la CLI mínima.
- **Comprobación:** las pruebas se ejecutan y detectan una salida o un código de error incorrectos. No presentar estas pruebas como validación del auditor completo.
- **Commit propuesto:** `test: set up the CLI test runner`.

### Paso 3 — definir las entradas y el informe

- **Cambios:** introducir los tipos de referencia, origen, ubicación, estado de variable, incidencia, cobertura e informe versionado. Definir los cinco códigos de incidencia y sus severidades.
- **Comprobación:** el modelo permite distinguir ausencia de vacío y cobertura limitada de ejecución fallida; ningún tipo público del informe admite valores de entorno. Comprobar tipos, sin crear tests triviales para interfaces.
- **Commit propuesto:** `feat: define the audit data model`.

### Paso 4 — detectar referencias de Node

- **Cambios:** implementar el analizador puro para `process.env.NAME` y `process.env["NAME"]`, con archivo, línea y columna basados en 1. Utilizar el compilador TypeScript; solicitar autorización antes de convertirlo en dependencia de producción del motor.
- **Comprobación:** detectar accesos literales; ignorar comentarios y cadenas; comprobar ubicaciones exactas y múltiples usos de un mismo nombre.
- **Commit propuesto:** `feat: detect Node environment references`.

### Paso 5 — detectar referencias de Vite y archivos JSX

- **Cambios:** añadir `import.meta.env.NAME` y accesos con cadena literal. Seleccionar correctamente la sintaxis de `.ts`, `.tsx`, `.js` y `.jsx`. Excluir las propiedades internas de Vite solo en referencias de `import.meta.env`.
- **Comprobación:** los cuatro tipos de archivo funcionan; `import.meta.env.MODE` se excluye y `process.env.MODE` se conserva.
- **Commit propuesto:** `feat: detect Vite environment references`.

### Paso 6 — informar de accesos no resolubles

- **Cambios:** representar accesos dinámicos como `process.env[key]`; indicar que el análisis cubre referencias directas. Documentar alias, desestructuración, envoltorios y resolución de identificadores como límites del MVP.
- **Comprobación:** un acceso calculado produce `DYNAMIC_REFERENCE`; no inventar nombres ni presentar cobertura completa. Una referencia admitida sigue detectándose junto a otra dinámica.
- **Commit propuesto:** `feat: report dynamic environment references`.

### Paso 7 — descubrir archivos del proyecto

- **Cambios:** crear el recorrido de archivos fuente dentro de la raíz elegida; excluir dependencias, control de versiones y salidas de compilación. Ordenar rutas relativas y omitir enlaces simbólicos.
- **Comprobación:** fixtures con archivos anidados, carpetas excluidas y extensiones no admitidas devuelven la lista correcta. No ejecutar ni modificar archivos.
- **Commit propuesto:** `feat: discover project source files`.

### Paso 8 — acotar rutas y recursos

- **Cambios:** validar raíz y rutas seleccionadas; impedir escapes de la raíz; rechazar enlaces en archivos de entorno elegidos. Aplicar los límites de lectura y recorrido antes de leer contenido y controlar archivos que crecen durante la lectura.
- **Comprobación:** cubrir `..`, enlaces internos y externos, archivos excesivos y límites acumulados. Un límite alcanzado produce un fallo explícito, no un análisis silenciosamente incompleto.
- **Commit propuesto:** `feat: enforce safe file scanning limits`.

Límites iniciales: 2 MiB por archivo fuente, 256 KiB por archivo de entorno, 20.000 entradas recorridas y 50 MiB de código leído por análisis. Estos valores son parte de la configuración interna documentada y pueden revisarse si la validación demuestra una necesidad.

### Paso 9 — leer documentación y configuración de entorno

- **Cambios:** leer `.env.example` y el archivo elegido, usando un parser con comportamiento conocido. Reducir inmediatamente la configuración a nombres y estados `present`/`empty`. No fusionar otros archivos ni las variables del proceso.
- **Comprobación:** cubrir nombres presentes, ausentes y vacíos; comentarios, comillas, líneas múltiples y duplicados. Documentar qué sintaxis se admite y qué sucede con entradas no admitidas.
- **Commit propuesto:** `feat: read environment variable states`.

### Paso 10 — proteger errores de lectura y parsing

- **Cambios:** normalizar fallos de acceso y de formato a errores propios, con códigos seguros. No incluir contenido, valores ni mensajes crudos del parser. No expandir variables ni interpretar comandos del archivo.
- **Comprobación:** archivos ausentes, ilegibles y casos de formato definidos tienen un resultado claro. Valores señuelo no aparecen en ningún diagnóstico; no afirmar validación estricta si el parser no la ofrece.
- **Commit propuesto:** `feat: add safe environment diagnostics`.

### Paso 11 — comparar variables no documentadas y ausentes

- **Cambios:** implementar `UNDOCUMENTED_VARIABLE` y `MISSING_VARIABLE` en el comparador puro. La primera es una advertencia; la segunda exige que el nombre esté declarado en `.env.example`.
- **Comprobación:** probar la secuencia de documentar y configurar `DATABASE_URL`, además de variables documentadas sin referencias detectadas. No inferir obligatoriedad a partir de un acceso al código.
- **Commit propuesto:** `feat: detect undocumented and missing variables`.

### Paso 12 — comparar variables vacías y posiblemente sin uso

- **Cambios:** implementar `EMPTY_VARIABLE` y `POSSIBLY_UNUSED_VARIABLE` como advertencias. Integrar el contexto de referencias dinámicas y evitar recomendaciones de borrado automático.
- **Comprobación:** vacío no equivale a ausente; sin referencias directas no equivale a certeza de que una variable sobre. Probar resultados con accesos dinámicos presentes.
- **Commit propuesto:** `feat: report empty and possibly unused variables`.

### Paso 13 — construir un informe estable

- **Cambios:** reunir referencias, incidencias, resumen y cobertura en el contrato versionado. Ordenar resultados por ruta, ubicación y código, y definir qué se deduplica sin perder ubicaciones de usos distintos.
- **Comprobación:** entradas idénticas y recorridos con distinto orden producen el mismo informe. Los recuentos coinciden con las incidencias y no hay valores, fragmentos de código ni timestamps innecesarios.
- **Commit propuesto:** `feat: build deterministic audit reports`.

### Paso 14 — coordinar un análisis completo

- **Cambios:** implementar `audit.ts` para conectar recorrido, lectura, extracción, comparación e informe. Mantener el motor sin efectos secundarios y propagar fallos operativos de forma clara.
- **Comprobación:** un proyecto sintético produce las incidencias esperadas; un fallo de lectura no se transforma en un resultado correcto vacío. Los archivos auditados permanecen intactos.
- **Commit propuesto:** `feat: audit a local project`.

### Paso 15 — presentar el informe en texto

- **Cambios:** crear el reporter de texto con nombre, severidad, explicación y ubicaciones. Diferenciar un resultado sin incidencias de un análisis fallido o limitado.
- **Comprobación:** una persona puede localizar una variable y entender qué corregir. No depender de colores para expresar severidad ni imprimir valores.
- **Commit propuesto:** `feat: format readable audit results`.

### Paso 16 — serializar el informe en JSON

- **Cambios:** crear la salida JSON del contrato versionado. Definir también la representación de fallos operativos, sin mezclar texto decorativo con stdout.
- **Comprobación:** las salidas de éxito y error documentadas pueden parsearse; datos señuelo no aparecen; el resultado conserva orden y recuentos coherentes.
- **Commit propuesto:** `feat: export audit results as JSON`.

### Paso 17 — conectar el comando de auditoría

- **Cambios:** añadir `check <root> --env <file> --example <file> --format text|json` a la CLI. Exigir `--env`, permitir `.env.example` como ejemplo por defecto y validar opciones y rutas. Mantener el parsing de argumentos separado del motor.
- **Comprobación:** ejecutar el comando compilado con ambos formatos, rutas con espacios, opciones desconocidas y opciones incompletas. La ayuda solo anuncia comportamiento implementado.
- **Commit propuesto:** `feat: add the environment check command`.

### Paso 18 — cerrar códigos de salida y fallos operativos

- **Cambios:** aplicar `0` para análisis sin incidencias de severidad error; `1` para un informe válido con errores de configuración; `2` para argumentos inválidos o análisis que no puede completarse. Controlar qué se escribe en stdout y stderr en cada formato.
- **Comprobación:** probar advertencias solas, variables esperadas ausentes, fallos de lectura y límites. Un consumidor de CI puede distinguir cada caso sin analizar frases.
- **Commit propuesto:** `feat: define CLI exit codes and operational errors`.

### Paso 19 — validar el recorrido de extremo a extremo

- **Cambios:** añadir fixtures con referencias Node/Vite, duplicados de uso, accesos dinámicos y configuraciones corregidas. Añadir comprobaciones de no modificación y de ausencia de valores en stdout, stderr y JSON.
- **Comprobación:** ejecutar la CLI real sobre fixtures temporales y comprobar resultados antes y después de corregir la configuración. Usar únicamente valores inventados; los `.env` necesarios se generan en ubicaciones temporales o se guardan como fixtures claramente identificados.
- **Commit propuesto:** `test: cover complete environment audits`.

### Paso 20 — comprobar la distribución local del paquete

- **Cambios:** definir el ejecutable del paquete y los archivos que se empaquetan. Mantener fuera los fixtures, entornos, configuraciones privadas y artefactos temporales que no pertenecen al producto.
- **Comprobación:** generar un paquete local, inspeccionar su contenido e instalarlo en una ubicación temporal. El comando funciona desde esa instalación con sus dependencias declaradas. No publicar en un registro.
- **Commit propuesto:** `chore: prepare and verify the CLI package`.

### Paso 21 — documentar el uso real

- **Cambios:** escribir el README con propósito, requisitos, instalación local comprobada, ejemplos de texto/JSON, códigos de salida y limitaciones. Añadir un ejemplo pequeño de integración continua.
- **Comprobación:** seguir los comandos desde una instalación limpia. No documentar un paquete publicado o un comando que aún no esté disponible. Los ejemplos no contienen secretos reales.
- **Commit propuesto:** `docs: document CLI usage and limitations`.

### Paso 22 — automatizar las verificaciones en CI

- **Cambios:** añadir un workflow de GitHub Actions para instalar con lockfile, comprobar tipos, compilar y ejecutar las pruebas reales. Usar permisos mínimos y no exigir secretos para esos checks.
- **Comprobación:** revisar el workflow y verificar su resultado cuando el propietario decida subir el commit. No confundir pruebas locales con una ejecución remota que todavía no ha ocurrido.
- **Commit propuesto:** `ci: check types build and tests`.

### Paso 23 — registrar la validación del MVP

- **Cambios:** probar con tres desarrolladores y al menos un proyecto ajeno autorizado. Documentar resultados técnicos no sensibles: instalación, comprensión, falsos positivos, incidencias detectadas y limitaciones observadas. No publicar datos de participantes ni contenido privado de sus proyectos.
- **Comprobación:** distinguir observaciones realizadas de validación pendiente. Convertir cada corrección sustancial encontrada en un paso adicional con un fixture reproducible; no reunir todos los bugs en este commit documental.
- **Commit propuesto:** `docs: record CLI validation results`.

### Paso 24 — preparar la primera entrega

- **Cambios:** revisar versión, notas de cambios y checklist de entrega. Confirmar que documentación, contrato y paquete corresponden a lo que realmente funciona.
- **Comprobación:** compilar, probar y repetir la comprobación del paquete solo si hay cambios o riesgos nuevos. La publicación, tags, releases y eliminación de `private` requieren una decisión y autorización posteriores del propietario. Comprobar disponibilidad del nombre si se decide publicar en npm.
- **Commit propuesto:** `chore: prepare the first CLI release`.

## Decisión antes de la entrega 2

El visor React se construye si la CLI es fiable y el propietario decide que aporta valor. Su objetivo es explorar informes, no volver a leer archivos de entorno ni crear una plataforma remota. Si la validación aconseja mejorar la CLI antes, priorizar esos pasos y actualizar el orden.

## Entrega 2 — visor React

### Paso 25 — acordar el visor y su estructura

- **Cambios:** definir el recorrido de importar un informe, revisar el resumen y filtrar incidencias. Acordar el estilo visual, estados y estructura de carpetas. Decidir cómo compartir el contrato sin enviar código de Node ni el compilador al navegador.
- **Comprobación:** la propuesta contempla un informe válido, uno sin incidencias, uno inválido y uno con cobertura limitada. No crear cuentas, servidor remoto o workspaces adicionales por defecto.
- **Commit propuesto:** `docs: define the report viewer scope`.

### Paso 26 — preparar React y Vite

- **Cambios:** crear la base acordada del visor, TypeScript y scripts de desarrollo y compilación. Solicitar autorización para las dependencias de producción nuevas, incluyendo React y React DOM.
- **Comprobación:** ejecutar el visor y compilarlo. Mantener funcionando la CLI y sus scripts. No afirmar que existe importación o análisis hasta implementarlos.
- **Commit propuesto:** `chore: set up the React report viewer`.

### Paso 27 — validar informes en el navegador

- **Cambios:** introducir validación en ejecución del informe y su versión, compartiendo un contrato puro cuando corresponda. Aplicar límites a tamaño, listas y campos de la entrada. No confiar en tipos TypeScript para validar JSON externo.
- **Comprobación:** rechazar JSON inválido, versiones no compatibles, estructuras incorrectas y entradas excesivas con mensajes seguros. No incluir módulos de filesystem ni TypeScript en el bundle.
- **Commit propuesto:** `feat: validate imported audit reports`.

### Paso 28 — importar informes y mostrar el resumen

- **Cambios:** añadir selección de archivo local y resumen de recuentos. Procesar el informe en memoria, sin subirlo a servidores ni persistirlo por defecto.
- **Comprobación:** importar un informe de la CLI, reemplazarlo por otro y cancelar la selección. Los recuentos coinciden; no hay peticiones con contenido del archivo.
- **Commit propuesto:** `feat: import reports and display their summary`.

### Paso 29 — explorar incidencias y ubicaciones

- **Cambios:** mostrar severidad, código, variable y ubicación; añadir filtros por severidad, tipo y búsqueda de nombre o archivo. Renderizar campos como texto y no abrir rutas o URLs provenientes del informe automáticamente.
- **Comprobación:** los filtros pueden combinarse y restablecerse; no alteran el informe original. Texto con HTML o URLs se muestra de forma segura.
- **Commit propuesto:** `feat: browse and filter report issues`.

### Paso 30 — resolver los estados de la interfaz

- **Cambios:** completar los estados sin archivo, cargando, informe inválido, sin incidencias, búsqueda sin resultados y cobertura limitada. Explicar qué significa el resultado sin prometer que toda la configuración es correcta.
- **Comprobación:** cada estado ofrece un siguiente paso claro y permite importar otro informe. Un error no deja datos del informe anterior presentados como actuales.
- **Commit propuesto:** `feat: handle empty invalid and partial reports`.

### Paso 31 — cerrar accesibilidad y adaptación

- **Cambios:** revisar teclado, foco, etiquetas, contraste, anuncios de errores y diseño en pantallas pequeñas. Mantener el estilo acordado y evitar añadir una biblioteca de UI sin necesidad.
- **Comprobación:** completar importación y filtrado con teclado; probar tamaños habituales y nombres de archivos largos. Las diferencias de severidad se entienden sin color.
- **Commit propuesto:** `fix: improve viewer accessibility and layout`.

### Paso 32 — probar los recorridos del visor

- **Cambios:** añadir pruebas de importación, validación, filtros, reemplazo de informes y estados de error con fixtures seguros. Elegir herramientas de pruebas apropiadas cuando exista la interfaz, sin añadir dependencias innecesarias.
- **Comprobación:** los recorridos reflejan comportamiento observable y detectan regresiones reales; confirmar que los informes no se envían por red ni se guardan automáticamente.
- **Commit propuesto:** `test: cover report viewer workflows`.

### Paso 33 — incorporar el visor a CI

- **Cambios:** añadir las comprobaciones reales de tipos, compilación y tests del visor al workflow, conservando las de la CLI. Ajustar instalación y caché a la estructura elegida.
- **Comprobación:** la ejecución remota pasa cuando el propietario suba los cambios. No tratar un build del visor como prueba de que la CLI sigue funcionando.
- **Commit propuesto:** `ci: verify the report viewer`.

### Paso 34 — documentar el recorrido completo

- **Cambios:** documentar cómo generar un informe con la CLI y abrirlo en el visor. Añadir una demo con datos sintéticos y capturas del producto real, además de límites y requisitos vigentes.
- **Comprobación:** otra persona puede repetir el recorrido con los comandos documentados. No incluir informes de proyectos privados ni publicar una demo sin autorización.
- **Commit propuesto:** `docs: explain the CLI and viewer workflow`.

### Paso 35 — validar ambas entregas juntas

- **Cambios:** completar la matriz de compatibilidad entre CLI, versión del informe y visor; registrar los resultados de una revisión del recorrido completo. Las correcciones necesarias se separan en pasos concretos antes de cerrar la entrega.
- **Comprobación:** informe válido, advertencias, errores de configuración, fallo operativo y entrada no compatible tienen resultados coherentes. Revisar que el visor no presenta como válidos los fallos operativos de la CLI.
- **Commit propuesto:** `docs: record end-to-end release validation`.

### Paso 36 — preparar la entrega completa

- **Cambios:** actualizar versión, notas de cambios y checklist de entrega para CLI y visor. Revisar qué componentes se distribuirán y dónde, según la decisión del propietario.
- **Comprobación:** instalar el paquete candidato y abrir el visor con informes de esa misma versión. Publicación de paquetes, sitio, tags o releases son acciones separadas que requieren autorización; no forman parte automática de este commit.
- **Commit propuesto:** `chore: prepare the complete project release`.

## Criterio de finalización

El proyecto está listo cuando un desarrollador puede instalar la CLI, auditar un proyecto dentro del alcance admitido, entender las incidencias y explorar el informe en el visor si se ha aprobado esa segunda entrega. Las pruebas y verificaciones deben ser reproducibles, las limitaciones deben estar documentadas y ningún recorrido debe imprimir valores de entorno, modificar el proyecto auditado o transmitir informes sin una decisión explícita del usuario.

La existencia de este plan, una interfaz terminada o un workflow escrito no basta para considerar la entrega validada. Se documenta lo comprobado y se mantiene visible lo que sigue pendiente.
