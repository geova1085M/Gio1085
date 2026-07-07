# KALLPA AI — API de agentes ejecutores

API en Node/Express que expone los tres agentes de IA de KALLPA AI
(Tributario SRI, Contable, Inteligencia de Mercado) para PYMEs
ecuatorianas, operados por Claude vía tool use, con supervisión humana
(HITL) para todo lo que se transmite oficialmente.

## Requisitos

- Node.js 18+
- Una API key de Anthropic (https://console.anthropic.com)

## Arranque rápido (VS Code)

```bash
npm install
cp .env.example .env      # pega tu ANTHROPIC_API_KEY en .env
npm run seed              # crea un tenant demo con comprobantes de ejemplo
npm start                 # levanta en http://localhost:3000
```

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
```

Todos requieren el header `x-tenant-ruc`. `mercado` además requiere que
el tenant tenga `plan` distinto de `emprendedor` (ver gating en
`routes/agentes-routes.js`).

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
| `agents/ensamblador.js` | Ensambla system prompt (con prompt caching) + tools, corre el ciclo `tool_use` contra Claude |
| `prompts/systemPromptBase.js` | Identidad + contexto de tenant (capa cacheada) |
| `prompts/ejecucion-{tributario,contable,mercado}.js` | Instrucciones de ejecución por módulo (capa cacheada) |
| `tools/definiciones.js` | Tool schemas (Anthropic tool use) por módulo |
| `tools/executor.js` | Dispatch de cada tool al backend real |
| `db/tenants.js` | SQLite: una DB por RUC (comprobantes, contabilidad) + una compartida (tenants, tickets, métricas) |
| `contabilidad-db.js` | Motor contable de doble partida (simplificado) |
| `f104-borrador.js` / `semaforo.js` | Borrador de IVA determinista + reglas de semáforo |
| `estudio-mercado.js` | Persistencia de estudio + render de PDF (pdfkit) |

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

## Datos de prueba

`npm run seed` crea el tenant `0912345678001` (RIMPE Emprendedor, plan
PYME, "Ferretería La Esquina S.A.S.") con 3 ventas y 2 compras del mes
en curso, más una retención de IVA recibida — suficiente para ejercitar
los 5 flujos del agente tributario y los 5 del contable de punta a
punta.
