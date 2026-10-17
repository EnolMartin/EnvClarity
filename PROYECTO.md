# EnvClarity — definición inicial

Nombre: EnvClarity. Estado: alcance definido; implementación pendiente.

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
- pnpm para gestionar dependencias; versión inicial fijada en `package.json`. Node 24 para el entorno de desarrollo.
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
