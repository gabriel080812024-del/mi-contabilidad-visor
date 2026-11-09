# Mi Contabilidad – Visor

App para ver en el iPhone (o Android) los datos de **Mi Contabilidad**, **sin internet** y **solo lectura**.

- **No contiene datos.** Los datos llegan en un archivo `.mcvisor` que se crea en la Mac y se pasa al teléfono (AirDrop).
- El archivo va cifrado (AES-256-GCM, llave PBKDF2-SHA256 de 600 000 vueltas). Se descifra **dentro del teléfono**; nada se envía a ningún sitio.
- Funciona sin conexión gracias a un *service worker* (después de instalarla una vez).

## Instalar en el iPhone
1. Abre la dirección de esta página en **Safari**.
2. Botón **Compartir** → **Agregar a pantalla de inicio**.
3. Abre la app desde el icono.
