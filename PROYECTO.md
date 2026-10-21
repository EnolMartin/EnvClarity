# EnvClarity — definición inicial

Nombre: EnvClarity. Estado: motor y reporters conectados a la CLI; códigos de salida y canales definidos.

## Objetivo

Ayudar a un desarrollador a configurar un proyecto TypeScript, Node o React sin descubrir las variables de entorno que faltan a base de errores.

La herramienta debe explicar qué variable necesita cada proyecto, dónde se utiliza y si está documentada y configurada. Trabaja en local y no muestra ni envía los valores de las variables.

## Usuario inicial

Un desarrollador que incorpora un colaborador o prepara un despliegue de una aplicación React con Vite y un backend Node. La primera versión analiza un proyecto cada vez; el soporte de monorepos queda para una fase posterior.

## Ejemplo de utilidad

El backend utiliza `process.env.DATABASE_URL`, pero `.env.example` no la documenta. El auditor emite `UNDOCUMENTED_VARIABLE` e indica el archivo y la línea donde se utiliza, sin imprimir valores.

Una vez documentada, si falta en el archivo de entorno seleccionado, emite `MISSING_VARIABLE`. Tras configurarla, el mismo análisis deja de informar de ambas incidencias.

## Primera versión

Una CLI en TypeScript con un motor de análisis separado de la presentación del informe.

1. Analizar archivos `.ts`, `.tsx`, `.js` y `.jsx` mediante su estructura sintáctica, sin ejecutar el código del proyecto.
2. Reconocer accesos directos con nombre literal: `process.env.NAME`, `process.env["NAME"]`, `import.meta.env.NAME` e `import.meta.env["NAME"]`.
3. Comparar esas referencias con `.env.example` y con un archivo de entorno elegido explícitamente por el usuario.
4. Emitir informes de texto y JSON con códigos de incidencia, nombres de variables y ubicaciones en el código.
5. Permitir usar el resultado en integración continua mediante códigos de salida documentados.

En Vite, propiedades propias del framework como `MODE`, `BASE_URL`, `DEV`, `PROD` y `SSR` no se tratarán como variables que el usuario deba definir. La exclusión solo se aplica a referencias de `import.meta.env`; nombres como `process.env.MODE` siguen siendo variables normales.

### Incidencias

| Código | Significado | Comportamiento inicial |
| --- | --- | --- |
| `UNDOCUMENTED_VARIABLE` | Una variable utilizada no aparece en `.env.example`. | Advertencia. |
| `MISSING_VARIABLE` | Una variable documentada no existe en el archivo de entorno seleccionado. | Error. |
| `EMPTY_VARIABLE` | Una variable documentada tiene un valor vacío en ese archivo. | Advertencia; vacío no siempre significa inválido. |
| `POSSIBLY_UNUSED_VARIABLE` | Una variable documentada no tiene referencias directas detectadas. | Advertencia; no se afirma que sobre. |
| `DYNAMIC_REFERENCE` | Un acceso utiliza un nombre que no se puede resolver estáticamente. | Advertencia sobre cobertura incompleta. |

Que una variable se use no demuestra que sea obligatoria: puede existir un valor por defecto o un uso opcional. Inicialmente, `.env.example` actuará como lista de variables esperadas. Un manifiesto explícito con variables obligatorias y opcionales podrá añadirse después.

El informe describirá el estado de los archivos seleccionados. No afirmará conocer la configuración real del servidor ni las variables inyectadas por una plataforma de despliegue.

### Límites del análisis

El MVP analiza referencias sintácticas directas a `process.env` e `import.meta.env`. Reconoce nombres mediante punto o cadenas literales entre corchetes. Los demás accesos calculados, como `process.env[key]` e `import.meta.env[key]`, se registran en `dynamicReferences` solo con origen y ubicación, sin inferir nombres ni conservar contenido fuente. Este registro permitirá generar `DYNAMIC_REFERENCE` en la fase de construcción de incidencias.

No resuelve alias, desestructuración, funciones envoltorio ni identificadores: incluso si `key` se declara con una cadena constante, el acceso sigue siendo dinámico. Tampoco evalúa expresiones calculadas ni distingue símbolos locales llamados `process`. La cobertura se limita a referencias directas; no pretende detectar filtraciones de secretos ni demostrar que una variable del servidor llega al navegador.

### Lectura de archivos de entorno

La capa de lectura `readEnv(files, environmentPath, examplePath)` recibe la sesión `ProjectFiles` del análisis y lee secuencialmente dos archivos acotados: `.env.example` por defecto (o la ruta explícita alternativa) y el archivo elegido, cuya ruta es obligatoria. Devuelve nombres documentados únicos y entradas `{ name, state }` ordenadas por nombre. Solo produce `present` y `empty`; un nombre ausente no genera una entrada. `audit` coordina esta lectura y la comparación; la CLI consume su resultado.

Se utiliza un lector propio que clasifica directamente por posiciones en el contenido acotado, sin construir cadenas de valores ni un objeto de valores parseados. Un `Map` conserva únicamente nombres y estados, incluidos nombres especiales como `__proto__`, sin asignar propiedades por nombre ni modificar prototipos. No se añaden dependencias. El contenido original permanece transitoriamente en memoria; no se garantiza su borrado físico. No se fusionan otros archivos ni `process.env`, no se modifica el entorno del proceso, no se expanden `$NAME`/`${NAME}` ni se ejecutan comandos o JavaScript.

Contrato de sintaxis, común a todas las versiones soportadas:

- Admite asignaciones con `=`, comentarios con `#` y finales LF/CRLF. Las líneas vacías se ignoran. Sin comillas, el contenido termina al final de esa línea o en `#`; los espacios no cuentan como contenido. `A=   ` seguido de `B=synthetic` produce `A: empty` y conserva `B: present`.
- Recorta espacios alrededor del nombre. Conserva la admisión previa de nombres con dígitos iniciales, guiones, puntos, espacios y caracteres no ASCII; no valida identificadores. Rechaza nombres vacíos (también tras retirar `export`) o que contengan `#`. `constructor`, `toString`, `hasOwnProperty` y `__proto__` son nombres ordinarios.
- El prefijo literal `export`, seguido de espacios o tabuladores, se elimina tanto en asignaciones vacías como no vacías: `export A=` produce el nombre `A` y estado `empty`.
- Admite comillas simples, dobles y acentos graves al principio del contenido, también multilínea. Cierra en la primera comilla del mismo tipo; `#`, espacios y saltos de línea dentro de las comillas cuentan como contenido. Tras el cierre solo admite espacios o un comentario `#` hasta el final de esa línea. Las tres formas de comillas vacías producen `empty`; las que contienen espacios o saltos de línea producen `present`. Las barras inversas no escapan delimitadores y no se interpretan secuencias de escape: cualquier secuencia como `\n` es contenido no vacío. No se necesita decodificarla para distinguir los estados.
- En duplicados, **gana la última aparición**, también si reemplaza contenido por vacío. `.env.example` se deduplica con la misma regla.

El lector rechaza con `FORMAT_ERROR` las líneas no vacías ni de comentario sin `=` (incluidas asignaciones solo con `:`), los nombres vacíos o con `#`, las comillas iniciales sin cierre del mismo tipo, el texto distinto de espacios/comentario tras ese cierre y cualquier carácter NUL, incluso dentro de comentarios o comillas. Si cualquiera de los dos archivos falla, `readEnv` rechaza su promesa sin entregar nombres ni estados parciales.

Son comprobaciones concretas del formato admitido, no validación estricta de dotenv ni de identificadores. Una comilla posterior puede cerrar contenido multilínea y absorber declaraciones intermedias. Las comillas dentro de contenido sin comillas iniciales son texto literal; un nombre no vacío con `:` y `=` sigue siendo admisible. No se comprueba la codificación original: la lectura existente decodifica bytes como UTF-8 con sustitución de secuencias inválidas. No se prometen escapes, expansión ni semántica de shell.

Los fallos operativos reutilizan `ScanError` y los códigos de `AuditFailureCode`: `READ_ERROR` para archivos ausentes, ilegibles o fallos nativos de lectura; `INVALID_INPUT` para rutas no admitidas; `LIMIT_EXCEEDED` para presupuestos y `FORMAT_ERROR` para los rechazos anteriores. Sus mensajes son constantes y no contienen rutas seleccionadas, valores, contenido, líneas completas, mensajes originales ni `cause`. El parsing de cada archivo ocurre dentro de la operación protegida de `ProjectFiles`: un fallo de formato invalida persistentemente la misma sesión, al igual que los de lectura, rutas o límites. Reparar el archivo no permite reanudar esa sesión; se necesita un análisis nuevo. Se conservan las protecciones de rutas y los presupuestos compartidos. `audit` descarta resultados parciales y la CLI presenta el fallo mediante el reporter seleccionado.

Se evaluó [`util.parseEnv`](https://nodejs.org/download/release/v24.17.0/docs/api/util.html#utilparseenvcontent) y se descartó para este contrato: tanto Node 24.17.0 como 26.0.0 consumen incorrectamente la siguiente asignación después de espacios tras `=` y conservan `export` en el nombre de una asignación vacía. Además, 24.17.0 omite `__proto__` y 26.0.0 lo conserva. Las pruebas exigen los resultados correctos del lector propio, sin expectativas condicionadas por la versión.

### Comando de auditoría

Después de `pnpm build`, ejecutar:

```sh
node dist/cli.js check "/ruta/proyecto con espacios" --env "config/selected env"
node dist/cli.js check "/ruta/proyecto con espacios" --env "config/selected env" --example "config/other example" --format json
node dist/cli.js --help
```

`check` exige exactamente una raíz y `--env` explícito. El ejemplo predeterminado es `.env.example` y el formato predeterminado es `text`. Las rutas relativas de los archivos seleccionados parten de la raíz auditada, no del directorio actual; también se admiten rutas absolutas dentro de esa raíz. No se mezclan otros entornos ni `process.env`. La validación efectiva de rutas, enlaces y presupuestos permanece en la capa de lectura existente.

El parser separado `parseCliArguments` usa `util.parseArgs` estricto y rechaza comandos desconocidos, posicionales sobrantes o vacíos, opciones desconocidas, duplicadas (aunque repitan valor), incompletas o vacías y formatos distintos de `text`/`json`. Admite `--option=value`, opciones después de `check` en cualquier orden y `--` para terminar opciones. La ayuda se muestra sin argumentos o con `--help`/`-h` usados solos; no permite combinarlos con una auditoría. Los errores de argumentos son constantes y nunca reproducen entradas ni errores nativos.

La CLI llama a `audit` y entrega su `AuditResult` completo a `formatText` o `formatJson`, sin duplicar reglas ni construir otro informe. Decide el código de salida a partir del estado del resultado y de `report.summary.errorCount`, sin volver a comparar variables ni contar incidencias.

| Situación | Código de salida | stdout | stderr |
| --- | --- | --- | --- |
| Ayuda (sin argumentos, `--help` o `-h`) | `0` | Ayuda y contrato de salidas. | Vacío. |
| Análisis completado sin incidencias de severidad error, aunque haya advertencias | `0` | Informe completo en el formato seleccionado. | Vacío. |
| Análisis completado con al menos una incidencia de severidad error | `1` | Informe completo en el formato seleccionado, con errores, advertencias, referencias y cobertura. | Vacío. |
| Sintaxis inválida | `2` | Vacío. | `Invalid arguments. Use --help for usage.` y un salto de línea. |
| Fallo operativo de rutas, lectura, formato o límites | `2` | Resultado fallido en el formato seleccionado, sin informe parcial. | Vacío. |

Una auditoría JSON con sintaxis válida escribe únicamente un objeto JSON y un salto de línea en stdout, también con códigos `1` y `2`. En JSON, los fallos operativos contienen solo `status: "failed"` y `code`: `INVALID_INPUT`, `READ_ERROR`, `FORMAT_ERROR` o `LIMIT_EXCEEDED`; no se presentan como un análisis correcto sin incidencias. En texto se muestra el código seguro, una orientación constante y la indicación de que no hay informe completado. Los fallos no reproducen argumentos sensibles, rutas seleccionadas, valores ni errores originales. Una sintaxis inválida no selecciona formato: usa el diagnóstico constante de stderr incluso si incluía `--format=json`. No se imprime ayuda ni progreso junto al resultado. La cobertura limitada y las advertencias, incluidas referencias dinámicas, no convierten por sí mismas un análisis completado en código `1` o `2`.

Las pruebas del ejecutable compilado comprueban códigos, stdout y stderr en ambos formatos para informes limpios, solo advertencias (las cuatro clases), solo errores y errores junto con advertencias (las cinco incidencias). También cubren ayuda, valores predeterminados, ejemplo alternativo, rutas con espacios, sintaxis inválida y cada código de fallo operativo. Usan proyectos temporales con valores inventados; comparan informes completos con los reporters existentes, parsean JSON y verifican ausencia de valores señuelo en ambos canales. Una instantánea recursiva de contenido y metadatos, antes y después de ejecutar ambos formatos con y sin permisos de solo lectura de Node, comprueba que no se ejecutan scripts, módulos, configuración ni comandos del entorno y no se modifica el proyecto. No constituye una instantánea atómica frente a cambios externos ni una revisión exhaustiva de CI.

Verificación del paso 18: `pnpm typecheck` y `pnpm test` pasan con Node **24.17.0 y 26.0.0**, usando pnpm **11.8.0**: **215 pruebas por versión**, incluidas 62 de la CLI compilada (con subpruebas), sin fallos ni omisiones. Pasa `git diff --check`.

### Formato JSON de resultados

El módulo puro `formatJson(result: AuditResult): string`, en `src/reporters/json.ts`, devuelve un único objeto JSON compacto, sin texto decorativo ni salto de línea final. No imprime ni lee archivos. Consume el contrato tipado existente; no valida JSON externo. La CLI lo reutiliza y añade un salto de línea; el reporter no decide códigos de salida.

Un análisis completado se representa como `{ "status": "completed", "report": AuditReport }`. Conserva `report.schemaVersion: 1`, sin introducir otra versión ni duplicar el contrato. `completed` significa que el análisis terminó, incluso cuando hay incidencias de severidad `error`; la cobertura limitada tampoco es un fallo operativo.

Campos permitidos, proyectados explícitamente en cada nivel:

| Objeto | Campos |
| --- | --- |
| Resultado completado | `status`, `report` |
| Informe | `schemaVersion`, `summary`, `issues`, `references`, `coverage` |
| Resumen | `errorCount`, `warningCount` |
| Incidencia de variable | `code`, `severity`, `name`, `references` |
| Incidencia `DYNAMIC_REFERENCE` | `code`, `severity`, `reference` (sin nombre inferido) |
| Referencia de variable | `name`, `origin`, `location` |
| Referencia dinámica | `origin`, `location` |
| Ubicación | `path` relativa al proyecto, `line` y `column` basadas en 1 |
| Cobertura | `scope: "direct-references"`, `limitations` (códigos del contrato) |
| Resultado fallido | `status: "failed"`, `code` |

Las incidencias conservan los cinco códigos y severidades del contrato. `origin` es `process.env` o `import.meta.env`. No se recalculan reglas, recuentos, orden ni duplicados de los arrays de incidencias, referencias, referencias de cada incidencia o limitaciones. Los nombres y rutas se conservan como datos, con los escapes de JSON necesarios para recuperar los caracteres originales mediante `JSON.parse`. El orden de propiedades de salida es fijo, independiente de su inserción en la entrada; entradas con los mismos campos y arrays en el mismo orden producen cadenas idénticas. No se modifican las entradas.

Ejemplo de análisis completado sin incidencias ni referencias:

```json
{"status":"completed","report":{"schemaVersion":1,"summary":{"errorCount":0,"warningCount":0},"issues":[],"references":[],"coverage":{"scope":"direct-references","limitations":["ALIASES_NOT_RESOLVED","DESTRUCTURING_NOT_RESOLVED","WRAPPERS_NOT_RESOLVED","DYNAMIC_REFERENCES_NOT_RESOLVED"]}}}
```

Un fallo operativo contiene **únicamente** `status` y el código seguro `INVALID_INPUT`, `READ_ERROR`, `FORMAT_ERROR` o `LIMIT_EXCEEDED`. No contiene `report`, versión de informe, resumen ni resultados parciales, aunque existieran datos previos al fallo:

```json
{"status":"failed","code":"READ_ERROR"}
```

Se omiten propiedades adicionales de objetos y arrays en todos los niveles, incluidos valores, contenidos fuente, errores originales, mensajes, causas, timestamps y métodos `toJSON` adicionales. Solo se serializan los campos permitidos del contrato; los nombres y rutas admitidos siguen siendo visibles. Esta proyección no certifica la seguridad de datos arbitrarios introducidos en esos campos por un consumidor externo.

### Versiones de Node soportadas

`package.json` declara **`^24.17.0 || ^26.0.0`**: Node 24 desde 24.17.0 hasta antes de 25, y Node 26 desde 26.0.0 hasta antes de 27. Node 25 y otras versiones mayores no se declaran soportadas. `.nvmrc` fija 24.17.0 como base reproducible de desarrollo. La comprobación local del mismo contrato funcional y la suite completa utiliza **24.17.0 y 26.0.0**; no equivale a probar cada versión intermedia.

Para repetir la comprobación, colocar primero en `PATH` el directorio de cada versión de Node y ejecutar `node --version`, `pnpm exec node --version`, `pnpm typecheck` y `pnpm test`; después, `git diff --check`. Ambas ejecuciones usan los mismos archivos de prueba, incluidos los tres casos de regresión, sin cambiar expectativas por versión. Mantener pnpm en la versión fijada en `package.json`.

## Protección de datos y archivos

- No transmitir información a servicios externos ni añadir telemetría.
- No incluir valores en informes, errores ni registros, tampoco cuando el archivo de entorno sea inválido.
- No modificar archivos del proyecto auditado ni generar correcciones automáticamente.
- No ejecutar sus scripts, importar su configuración ejecutable ni instalar sus dependencias.
- Excluir dependencias, artefactos de compilación y carpetas de control de versiones.
- Limitar el recorrido a la raíz seleccionada y evitar seguir enlaces simbólicos fuera de ella.
- Aplicar límites de tamaño a los archivos procesados.

## Tecnologías y arquitectura

- TypeScript y Node para el motor y la CLI.
- pnpm para gestionar dependencias; versión fijada en `package.json`. Node 24.17.0 como base de desarrollo y soporte adicional para Node 26 según el rango y las comprobaciones anteriores.
- Analizador sintáctico de TypeScript como candidato para reconocer referencias con precisión. Su incorporación como dependencia de producción requiere aprobación antes de implementar.
- Separación mínima: lectura de archivos, extracción de referencias, comparación e informes.
- React con Vite para un informe visual local en una segunda fase.
- Sin base de datos, cuentas, servicio remoto ni suscripciones en la primera versión.

La interfaz visual consumirá el mismo modelo de informe que utiliza la CLI, sin duplicar las reglas de análisis.

## Secuencia de desarrollo

1. Motor: extraer referencias y ubicaciones de pequeños proyectos de ejemplo.
2. Comparación: leer los archivos de entorno y producir incidencias verificables.
3. CLI: seleccionar el proyecto y el entorno, mostrar texto y exportar JSON.
4. Fiabilidad: pruebas, límites de lectura y uso en integración continua.
5. Validación: probar la herramienta con desarrolladores y al menos un proyecto ajeno.
6. Interfaz React: añadir filtros y navegación por incidencias si esa validación confirma su utilidad.

## Criterios de aceptación

- Un comentario o una cadena que contenga `process.env.NAME` no genera una referencia falsa.
- Cada referencia detectada incluye el archivo y una línea correcta.
- Un proyecto de ejemplo reproduce incidencias que desaparecen tras corregir su configuración.
- Los accesos dinámicos no se presentan como un análisis completo.
- Los valores de prueba no aparecen en ninguna salida, incluida la salida de errores.
- Dos análisis de los mismos archivos producen el mismo informe.
- La herramienta no modifica el proyecto auditado.
- Los códigos de salida distinguen análisis sin errores, incidencias de error y fallo de ejecución.

## Hipótesis que validar

La diferenciación propuesta es explicar la relación entre código, documentación y configuración con poca preparación. Existen herramientas de validación y comparación de entornos; antes de ampliar el producto hay que comprobar que esta explicación aporta suficiente utilidad para que alguien lo adopte.

La señal inicial será que otro desarrollador pueda instalarlo y resolver una incidencia real sin asistencia. No se considera validación comercial únicamente que la idea resulte interesante.
