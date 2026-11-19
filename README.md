# Nexus PC Lab

El sitio usa Node.js para servir la página y PostgreSQL para conservar configuraciones compartidas. Cada proyecto guarda su nombre, tipo de equipo y los identificadores seleccionados de CPU, placa, RAM, gráfica y alimentación. El montaje visual 3D y los GLB locales no se guardan en la base de datos.

## Ejecutar localmente

1. Instala Node.js 20 o posterior.
2. En esta carpeta, ejecuta `npm install`.
3. Copia `.env.example` como `.env` y configura `DATABASE_URL` con una base PostgreSQL. `DATABASE_SSL` debe ser `false` para una conexión local; si se usa una URL externa que exige SSL, configúralo en `true`.
4. Ejecuta `npm start` y abre `http://localhost:3000`.

Si no configuras `DATABASE_URL`, la página se puede visualizar, pero la API de proyectos mostrará claramente que falta la base de datos.

## Publicar en Render

Necesitarás una cuenta de GitHub y una de Render. No compartas contraseñas ni pegues la URL de conexión de PostgreSQL en el código o en GitHub.

1. Crea un repositorio **privado** en GitHub y sube los archivos del proyecto. No subas `node_modules` ni `.env`; ya están excluidos por `.gitignore`.
2. En Render, crea una base **PostgreSQL**. Revisa el plan, el costo, la duración de conservación y las copias de seguridad antes de confirmarla.
3. En Render, crea un **Web Service** conectado al repositorio, en la misma región de la base de datos. Usa `npm install` como comando de compilación y `npm start` como comando de inicio.
4. En las variables de entorno del servicio, agrega `DATABASE_URL` con la **Internal Database URL** que muestra Render. No la publiques ni la pongas en archivos versionados. Puedes dejar `DATABASE_SSL` sin configurar al usar la URL interna.
5. Espera el despliegue y abre `/api/health` en el dominio asignado por Render. Debe responder `{"status":"ok"}`. Al iniciar, el servidor crea la tabla necesaria automáticamente.
6. Comparte el dominio `onrender.com`. Las configuraciones guardadas se podrán abrir y modificar desde cualquier dispositivo.

## Importante sobre el acceso público

La lista y las operaciones de creación y edición son públicas, tal como está configurado ahora: cualquier visitante puede modificar cualquier proyecto. No se implementó eliminación ni inicio de sesión. No guardes información personal ni uses esta versión para datos que necesiten control de acceso.
