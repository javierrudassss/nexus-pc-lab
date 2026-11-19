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
2. En Render, abre **New > Blueprint**, conecta `javierrudassss/nexus-pc-lab` y selecciona la rama `main`.
3. Revisa el plan antes de confirmar: [`render.yaml`](./render.yaml) define un servicio web **Free** y PostgreSQL **Free**. La base gratuita tiene 1 GB, no incluye copias de seguridad y expira a los 30 días; después hay 14 días para actualizarla antes de que Render elimine los datos. Consulta los [límites del plan gratuito](https://render.com/docs/free).
4. Si el resumen confirma que ambos recursos son Free y aceptas la expiración de la base, pulsa **Deploy Blueprint**. Render conecta automáticamente la base al servidor; no copies credenciales en el código.
5. Espera el despliegue y abre `/api/health` en el dominio asignado por Render. Debe responder `{"status":"ok"}`. Al iniciar, el servidor crea la tabla necesaria automáticamente.
6. Comparte el dominio `onrender.com`. Las configuraciones guardadas se podrán abrir y modificar desde cualquier dispositivo. El servicio web gratuito se duerme tras 15 minutos sin tráfico y puede tardar alrededor de un minuto en iniciar con la siguiente visita.

Para conservar proyectos a largo plazo, cambia el plan PostgreSQL por uno de pago y confirma su costo mensual antes de actualizar. Si la base gratuita se elimina, no habrá copias de seguridad gratuitas para recuperarla.

## Importante sobre el acceso público

La lista y las operaciones de creación y edición son públicas, tal como está configurado ahora: cualquier visitante puede modificar cualquier proyecto. No se implementó eliminación ni inicio de sesión. No guardes información personal ni uses esta versión para datos que necesiten control de acceso.
