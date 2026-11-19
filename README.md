# Nexus PC Lab

El sitio usa Node.js y PostgreSQL. Las personas pueden crear una cuenta e iniciar sesión; cada cuenta solo puede ver y editar sus propios proyectos. Los proyectos conservan el nombre, tipo de equipo y los identificadores seleccionados de CPU, placa, RAM, gráfica y alimentación. Los cambios se guardan automáticamente y también se pueden guardar con el botón **Guardar**. Si no se escribe un nombre, se asigna `Proyecto #1`, `Proyecto #2` y así sucesivamente.

Los proyectos guardados se pueden compartir mediante un enlace público. Cualquier persona que tenga el enlace puede ver la configuración y guardarla como copia editable en su propia cuenta; los cambios en esa copia no afectan el proyecto original. El propietario puede desactivar el enlace o generar uno nuevo desde **Compartir**. El montaje visual 3D y los GLB locales no se guardan en la base de datos.

Las contraseñas se guardan con hash scrypt, no como texto. Las sesiones usan cookies `HttpOnly`, `SameSite=Lax` y una tabla de PostgreSQL. El registro y el inicio de sesión tienen límites de intentos.

## Ejecutar localmente

1. Instala Node.js 20 o posterior.
2. En esta carpeta, ejecuta `npm install`.
3. Copia `.env.example` como `.env`, configura `DATABASE_URL` con una base PostgreSQL y cambia `SESSION_SECRET` por un secreto aleatorio de al menos 32 bytes. `DATABASE_SSL` debe ser `false` para una conexión local; si se usa una URL externa que exige SSL, configúralo en `true`.
4. Ejecuta `npm start` y abre `http://localhost:3000`.

Si no configuras `DATABASE_URL`, la página se puede visualizar, pero la API de proyectos mostrará claramente que falta la base de datos.

## Publicar en Render

Necesitarás una cuenta de GitHub y una de Render. No compartas contraseñas ni pegues la URL de conexión de PostgreSQL en el código o en GitHub.

1. Crea un repositorio **privado** en GitHub y sube los archivos del proyecto. No subas `node_modules` ni `.env`; ya están excluidos por `.gitignore`.
2. En Render, abre **New > Blueprint**, conecta `javierrudassss/nexus-pc-lab` y selecciona la rama `main`. El Blueprint genera `SESSION_SECRET` automáticamente y conecta PostgreSQL al servicio.
3. Revisa el plan antes de confirmar: [`render.yaml`](./render.yaml) define un servicio web **Free** y PostgreSQL **Free**. La base gratuita tiene 1 GB, no incluye copias de seguridad y expira a los 30 días; después hay 14 días para actualizarla antes de que Render elimine los datos. Consulta los [límites del plan gratuito](https://render.com/docs/free).
4. Si el resumen confirma que ambos recursos son Free y aceptas la expiración de la base, pulsa **Deploy Blueprint**. Render conecta automáticamente la base al servidor; no copies credenciales en el código.
5. Espera el despliegue y abre `/api/health` en el dominio asignado por Render. Debe responder `{"status":"ok"}`. Al iniciar, el servidor crea la tabla necesaria automáticamente.
6. Comparte el dominio `onrender.com`. Las configuraciones guardadas se podrán abrir y modificar desde cualquier dispositivo. El servicio web gratuito se duerme tras 15 minutos sin tráfico y puede tardar alrededor de un minuto en iniciar con la siguiente visita.

Para conservar proyectos a largo plazo, cambia el plan PostgreSQL por uno de pago y confirma su costo mensual antes de actualizar. Si la base gratuita se elimina, no habrá copias de seguridad gratuitas para recuperarla.

## Cuentas y privacidad

- La lista y edición de proyectos requieren iniciar sesión; el servidor filtra por la cuenta propietaria.
- Al desplegar la migración, se crea la tabla de usuarios, se añade la propiedad a los proyectos y se crea una tabla de sesiones. Los proyectos antiguos sin dueño no aparecen en ninguna cuenta. La base desplegada estaba vacía al añadir esta función.
- El registro no envía correo de verificación y no hay recuperación de contraseña. Si se pierde la contraseña, no hay una función para restablecerla.
- No se implementó eliminación de cuentas ni de proyectos. No uses la cuenta para información sensible.
- Los datos de PostgreSQL en el plan gratuito de Render siguen expirando según los límites documentados arriba.
