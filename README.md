# KALLPA AI — API de agentes ejecutores

API en Node/Express que expone los agentes de IA de KALLPA AI (Tributario
SRI, Contable, Inteligencia de Mercado, Cobros) para PYMEs ecuatorianas,
operados por Claude vía tool use, con supervisión humana (HITL) para todo
lo que se transmite oficialmente.

## Requisitos

- Node.js 18+
- Una API key de Anthropic (https://console.anthropic.com)

## Arranque rápido (VS Code)

```bash
npm install
cp .env.example .env      # pega tu ANTHROPIC_API_KEY en .env
npm run seed              # crea un tenant demo con comprobantes de ejemplo
npm run seed:cobros       # crea clientes y facturas vencidas para el agente de Cobros
npm start                 # levanta en http://localhost:3000
```

## Agente de Cobros — probar hoy mismo

El agente de Cobros gestiona tu cartera de clientes por cobrar: quién
debe, hace cuántos días, y envía (o simula) recordatorios por email,
WhatsApp o SMS. Es la "automatización tipo n8n" del proyecto, pero sin
n8n: en vez de un editor visual de nodos, es este mismo backend Node —
`tools/executor.js` decide qué pasa, `mensajeria.js` es el único punto de
salida para cualquier envío, y `semaforo-cobros.js` clasifica la urgencia
de forma determinista (nunca lo decide el modelo).

Cuatro formas de probarlo hoy:

1. **CRM en el navegador**: http://localhost:3000/crm.html — alta de
   clientes y facturas con un formulario, sin tocar código ni SQL.
2. **Chat de prueba en el navegador**: http://localhost:3000/chat.html —
   elige el módulo "cobros", escribe "¿quién me debe ahorita?", "agrega
   un cliente nuevo" o "envíale recordatorio a todos los morosos".
3. **`requests.http`** (VS Code + REST Client): bloques de `cobros`,
   `crm` y de automatización directa.
4. **Automatización sin chat** (simula el disparo de un cron/n8n):
   `POST /api/automatizacion/cobros/ejecutar` — corre la campaña completa
   de recordatorios sin pasar por Claude.

### Envío real de email (Gmail)

Por defecto los "envíos" se simulan: se imprimen en la consola del
servidor y quedan registrados en `gestiones_cobro`. Para que el canal
`email` envíe correos de verdad usando tu cuenta de Gmail:

1. Activa la verificación en 2 pasos en tu cuenta de Google (si no la
   tienes ya): https://myaccount.google.com/signinoptions/two-step-verification
2. Genera una **contraseña de aplicación**:
   https://myaccount.google.com/apppasswords (elige app "Correo" y
   dispositivo "Otro", ponle un nombre como "Kallpa Cobros").
3. En tu `.env`:
   ```
   MENSAJERIA_PROVIDER=gmail
   GMAIL_USER=tucorreo@gmail.com
   GMAIL_APP_PASSWORD=la contraseña de 16 caracteres que te dio Google
   ```
4. Reinicia el servidor. Ahora `enviarRecordatorio` y
   `ejecutarCampanaRecordatorios` mandan correos reales a los clientes con
   `canalPreferido = 'email'`.

⚠️ **Antes de probar la campaña masiva con este modo activo**, cambia el
email de tus clientes de prueba (`npm run seed:cobros` o el CRM) a un
correo tuyo — vas a mandarte recordatorios reales, no a clientes de
verdad. `whatsapp`/`sms` siguen simulados: no hay Twilio/WhatsApp Business
API conectado todavía (agregar un proveedor ahí es lo mismo que se hizo
con Gmail, en `mensajeria.js`).

En desarrollo con recarga automática:

```bash
npm run dev
```

Abre `requests.http` en VS Code (extensión **REST Client**, de Huachao
Mao) y haz clic en "Send Request" sobre cualquier bloque — no necesitas
salir del editor ni usar curl.

## Autenticación (⚠️ stub de desarrollo)

`middleware/auth.js` resuelve el tenant leyendo el header `x-tenant-ruc`
directamente, sin verificar nada. Es intencional para poder probar los
tres agentes sin montar un sistema de sesiones completo. **No lo
despliegues así**: antes de exponer esta API fuera de tu máquina,
reemplázalo por verificación real de sesión/JWT que resuelva el RUC
desde un token firmado por el servidor (ver el comentario de advertencia
en el propio archivo).

## Endpoints

```
POST /api/agentes/tributario   { mensaje, historial? }
POST /api/agentes/contable      { mensaje, historial? }
POST /api/agentes/mercado       { mensaje, historial? }
POST /api/agentes/cobros        { mensaje, historial? }

POST /api/automatizacion/cobros/ejecutar  { diasMinimo?, canal? }

GET    /api/crm/clientes
POST   /api/crm/clientes                       { nombre, identificacion?, email?, telefono?, canalPreferido? }
GET    /api/crm/clientes/:id
PUT    /api/crm/clientes/:id
DELETE /api/crm/clientes/:id                   (falla si tiene facturas pendientes)
POST   /api/crm/clientes/:id/facturas          { numero?, monto, fechaEmision?, fechaVencimiento }
PUT    /api/crm/facturas/:id
DELETE /api/crm/facturas/:id
```

Todos requieren el header `x-tenant-ruc`. `mercado` además requiere que
el tenant tenga `plan` distinto de `emprendedor` (ver gating en
`routes/agentes-routes.js`). El endpoint de automatización y los de
`/api/crm` no pasan por Claude: son CRUD/lógica determinista directa.

Respuesta:

```json
{
  "ok": true,
  "respuesta": "texto del agente",
  "toolsUsadas": ["obtenerComprobantesPeriodo", "generarBorradorF104"],
  "limiteAlcanzado": false
}
```

## Arquitectura (dónde tocar qué)

| Archivo | Responsabilidad |
|---|---|
| `server.js` | Entry point Express |
| `middleware/auth.js` | Resuelve `req.auth.ruc` (stub de dev) |
| `routes/agentes-routes.js` | HTTP → resolución de tenant → gating de plan → dispatch al ensamblador |
| `routes/automatizacion-routes.js` | Disparo directo de la campaña de cobros sin pasar por Claude (equivalente a un cron) |
| `routes/crm-routes.js` / `db/crm.js` | CRUD de clientes/facturas (API REST), reusado también por las tools del chat |
| `agents/ensamblador.js` | Ensambla system prompt (con prompt caching) + tools, corre el ciclo `tool_use` contra Claude |
| `prompts/systemPromptBase.js` | Identidad + contexto de tenant (capa cacheada) |
| `prompts/ejecucion-{tributario,contable,mercado,cobros}.js` | Instrucciones de ejecución por módulo (capa cacheada) |
| `tools/definiciones.js` | Tool schemas (Anthropic tool use) por módulo |
| `tools/executor.js` | Dispatch de cada tool al backend real |
| `db/tenants.js` | SQLite: una DB por RUC (comprobantes, contabilidad, clientes/facturas de cobros) + una compartida (tenants, tickets, métricas) |
| `contabilidad-db.js` | Motor contable de doble partida (simplificado) |
| `f104-borrador.js` / `semaforo.js` | Borrador de IVA determinista + reglas de semáforo |
| `semaforo-cobros.js` | Clasificación determinista de urgencia de cobro por días de atraso |
| `mensajeria.js` | Único punto de salida para recordatorios (email/whatsapp/sms); hoy simula, mañana se conecta a un proveedor real |
| `estudio-mercado.js` | Persistencia de estudio + render de PDF (pdfkit) |
| `public/chat.html` | Chatbot mínimo en el navegador para probar cualquier módulo sin REST Client |
| `public/crm.html` | CRM mínimo: alta/baja de clientes y facturas sin tocar código |

Cada uno de estos archivos tiene un subagente de Claude Code espejo en
`.claude/agents/` (ej. `kallpa-tools-executor`) con las reglas de
negocio que no se deben romper al modificarlo.

## Limitaciones conocidas (stub funcional, no producción)

- **Auth**: ver advertencia arriba.
- **`market_service.py`**: los handlers de mercado (`consultarSupercias`,
  `obtenerTendencias`, `detectarCompetencia`, `calcularScoreOportunidad`)
  hacen `fetch` a `MARKET_API_URL` (`http://localhost:8002` por
  defecto). Ese servicio Python no está incluido aquí — sin él, esas
  tools fallarán. `consultarSupercias`/`consultarAduanas` asumen un ETL
  ya cargado que tampoco existe en este repo.
- **Motor contable**: plan de cuentas reducido (15 cuentas) y reglas de
  clasificación simplificadas (una regla fija por dirección de
  comprobante), no el motor NIIF PYMES de 122 cuentas de producción.
- **Semáforo F104**: subconjunto de 2 reglas rojas + 2 amarillas de
  demostración, no las 5 rojas / 3 amarillas de la especificación
  completa.
- **PDF de estudio de mercado**: placeholder de una página con el JSON
  del estudio, no el diseño de marca Kallpa de 7 secciones.
- **Mensajería de cobros**: `mensajeria.js` trae `consola` (default) y
  `gmail` (SMTP con contraseña de aplicación) para el canal `email`.
  `whatsapp`/`sms` siguen siempre en modo consola — conectar WhatsApp
  Business API o Twilio es agregar un `case` más ahí, el resto del sistema
  no necesita cambiar. La escalación automática a "cobranza legal" en
  semáforo rojo crea un ticket en cada corrida de campaña sin deduplicar
  (no revisa si ya existe uno abierto para esa factura) — simplificación
  de demo, no el comportamiento de producción.
- **CRM de clientes**: `DELETE /api/crm/clientes/:id` bloquea el borrado
  si el cliente tiene facturas pendientes, pero no valida formato de
  email/teléfono ni deduplica clientes por identificación — validaciones
  a agregar antes de un uso real con datos de terceros.

## Datos de prueba

`npm run seed` crea el tenant `0912345678001` (RIMPE Emprendedor, plan
PYME, "Ferretería La Esquina S.A.S.") con 3 ventas y 2 compras del mes
en curso, más una retención de IVA recibida — suficiente para ejercitar
los 5 flujos del agente tributario y los 5 del contable de punta a
punta.
