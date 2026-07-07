/**
 * KALLPA AI — Ensamblador de agentes ejecutores
 * ==============================================
 * Une las tres capas de cada agente:
 *   1. Prompt base v2 (identidad + contexto multi-tenant) — CACHEADO
 *   2. Instrucciones de ejecución del módulo — CACHEADO
 *   3. Tools del módulo
 *
 * El prompt caching se aplica a las dos capas de system prompt
 * (cache_control: ephemeral) porque se repiten en cada llamada de la
 * sesión → 90% de ahorro en esos tokens desde la 2da llamada.
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildBasePromptV2 } from '../prompts/systemPromptBase.js'; // v2 canónico existente
import { EJECUCION_TRIBUTARIO } from '../prompts/ejecucion-tributario.js';
import { EJECUCION_CONTABLE } from '../prompts/ejecucion-contable.js';
import { EJECUCION_MERCADO } from '../prompts/ejecucion-mercado.js';
import { TOOLS_TRIBUTARIO, TOOLS_CONTABLE, TOOLS_MERCADO } from '../tools/definiciones.js';
import { ejecutarTool } from '../tools/executor.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODULOS = {
  tributario: { instrucciones: EJECUCION_TRIBUTARIO, tools: TOOLS_TRIBUTARIO },
  contable:   { instrucciones: EJECUCION_CONTABLE,   tools: TOOLS_CONTABLE },
  mercado:    { instrucciones: EJECUCION_MERCADO,    tools: TOOLS_MERCADO }
};

const MAX_ITERACIONES_TOOLS = 10; // techo de seguridad del ciclo agéntico

/**
 * Ejecuta una conversación completa con el agente del módulo indicado,
 * resolviendo el ciclo tool_use hasta la respuesta final.
 *
 * @param {string} modulo     'tributario' | 'contable' | 'mercado'
 * @param {object} tenant     Contexto del cliente (RUC, régimen, plan, semáforo)
 * @param {string} mensaje    Mensaje del usuario
 * @param {array}  historial  Mensajes previos [{role, content}]
 * @returns {object} { texto, uso: {input_tokens, output_tokens, cache...}, toolsUsadas }
 */
export async function ejecutarAgente(modulo, tenant, mensaje, historial = []) {
  const config = MODULOS[modulo];
  if (!config) throw new Error(`Módulo desconocido: ${modulo}`);

  // System prompt en dos bloques cacheados:
  // - base v2 con contexto del tenant (cambia por tenant, estable en la sesión)
  // - instrucciones de ejecución (idénticas para todos los tenants del módulo)
  const system = [
    {
      type: 'text',
      text: config.instrucciones,
      cache_control: { type: 'ephemeral' }
    },
    {
      type: 'text',
      text: buildBasePromptV2(tenant),
      cache_control: { type: 'ephemeral' }
    }
  ];

  const messages = [...historial, { role: 'user', content: mensaje }];
  const toolsUsadas = [];
  let usoAcumulado = { input_tokens: 0, output_tokens: 0 };

  for (let i = 0; i < MAX_ITERACIONES_TOOLS; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      system,
      tools: config.tools,
      messages
    });

    usoAcumulado.input_tokens += response.usage.input_tokens;
    usoAcumulado.output_tokens += response.usage.output_tokens;

    if (response.stop_reason !== 'tool_use') {
      // Respuesta final
      const texto = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      return { texto, uso: usoAcumulado, toolsUsadas };
    }

    // Ejecutar todas las tools solicitadas en este turno
    const toolUses = response.content.filter(b => b.type === 'tool_use');
    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        toolsUsadas.push(tu.name);
        const output = await ejecutarTool(tu.name, tu.input, tenant);
        return {
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(output)
        };
      })
    );

    messages.push(
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults }
    );
  }

  // Techo alcanzado: devolver estado parcial sin fingir completitud
  return {
    texto: 'La operación requirió demasiados pasos y fue detenida por ' +
           'seguridad. Un profesional Kallpa puede completarla — ¿deseas ' +
           'que la escale?',
    uso: usoAcumulado,
    toolsUsadas,
    limiteAlcanzado: true
  };
}
