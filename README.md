# Mira

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

Un panel de control web moderno, en tiempo real y autoalojado para monitorear tu unidad UPS APC (vía `apcupsd`) y administrar el apagado automatizado de ordenadores o nodos en caso de cortes de energía prolongados.

<div align="center">
  <img src="docs/assets/dashboard.png" alt="Vista del Dashboard Principal" width="800"/>
  <br/>
  <br/>
</div>

## 🚀 Características

* **📊 Monitoreo en Tiempo Real**: Visualiza el estado actual (Batería, Carga, Voltaje de entrada, Tiempo Restante) a través de WebSockets veloces.
* **🛡️ Sistema de Autenticación Integrado**: Protege tu panel contra accesos no autorizados mediante usuarios (vía JWT) con soporte a recuperación de contraseña.
* **⚡ Apagado de Nodos Escalonado (Swarm Shutdown)**: Orquesta automáticamente el apagado de múltiples máquinas a través de SSH en cuanto inicie el corte o la batería del UPS se agote, basándose en la prioridad que decidas.
* **🔔 Alertas Inteligentes**: Notificaciones *Push* integradas en navegador y notificaciones por **Email** a través de Resend.
* **📈 Historial y Gráficos**: Base de datos liviana incrustada (SQLite) que almacena tu historial de 24hs para visualizar tendencias.
* **🐳 Dockerizado**: Instálalo en segundos utilizando el contenedor ligero provisto en Docker Hub.

### Galería de la Interfaz

<div align="center">
  <img src="docs/assets/history.png" alt="Gráficas e Historial" width="48%"/> &nbsp;
  <img src="docs/assets/settings.png" alt="Opciones de Configuración" width="48%"/>
</div>

---

## 🐳 Despliegue con Docker (Recomendado)

La forma más sencilla de ponerlo en marcha es utilizando nuestra imagen preconstruida en Docker Hub: `lsantiagond/mira`.

### 1. Preparar archivo `docker-compose.yml`

Asegúrate de tener un demonio `apcupsd` corriendo en tu red, con `NIS` (Network Information Server) habilitado, típicamente en el puerto `3551`.

```yaml
version: '3.8'

services:
  mira:
    image: lsantiagond/mira:latest
    container_name: mira_dashboard
    ports:
      - "80:80"        # Puerto donde quieres exponer el panel web
    environment:
      - UPS_IP=192.168.1.10         # IP de la máquina/servidor que corre apcupsd
      - UPS_PORT=3551               # Puerto NIS
      - POLL_INTERVAL_MS=2000       # Cada cuántos milisegundos refrescar información a la interfaz
    volumes:
      - ups-data:/app/data          # Puntos de montaje para base de datos SQLite y config interna
    restart: unless-stopped

volumes:
  ups-data:
```

### 2. Variables de Entorno Adicionales (Opcionales)

El sistema soporta configurarse en base a variables inyectadas al contenedor:

| Variable | Por Defecto | Descripción |
| :--- | :--- | :--- |
| `UPS_IP` | (Obligatorio) | IP del demonio `apcupsd`. |
| `UPS_PORT` | `3551` | Puerto NIS del demonio `apcupsd` |
| `POLL_INTERVAL_MS`| `2000` | Refresco de datos locales en milisegundos. |
| `JWT_SECRET` | Aleatorio | Clave privada generada localmente para JWT. |

*(Nota: Cualquier configuración como Resend, claves VAPID o contraseñas se almacenan criptográficamente dentro de la persistencia de SQLite una vez lo configuras vía GUI)*

### 3. Ejecutar
```bash
docker-compose up -d
```

> Accede al navegador en `http://tu-ip:80` y serás dirigido a la pantalla de **Primer Inicio**, donde configurarás tu administrador principal (Admin).

---

## 🛠 Entorno de Desarrollo (Local)

Si planeas modificar el código o contribuir a la herramienta requieres tener instalado `Node.js` v20+.

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/lsantiagond/mira.git
   cd mira
   ```
2. Iniciar el Backend:
   ```bash
   cd backend
   npm install
   # Configura el archivo .env si necesitas correr contra otro UPS:
   # UPS_IP=192.168.1.10
   npm run dev
   ```
3. Iniciar el Frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

---

## 🤝 Contribuir

¡Aceptamos Pull Requests! Por favor abre un 'Issue' si notas cualquier posible mejora, o realiza tu PR directamente:

1. Realiza un Fork del proyecto.
2. Crea tu rama de características (`git checkout -b feature/novedadFantastica`).
3. Compromete (Commit) tus cambios (`git commit -m 'Agregar: novedad fantastica'`).
4. Haz push a la rama (`git push origin feature/novedadFantastica`).
5. Abre un PR y espera los checks automáticos.

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](LICENSE). Libre de ser utilizado, modificado, y distribuido.
