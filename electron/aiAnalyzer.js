/**
 * AI-powered schema analysis using the Anthropic Claude API.
 * Uses direct fetch calls (no SDK) for simplicity.
 */

const { logger } = require('./logger');

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5';
const ANTHROPIC_VERSION = '2023-06-01';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const ANALYZE_BASE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    antiPatterns: { type: 'array', items: { type: 'string' } },
    // Structured outputs require additionalProperties: false, so field names
    // can't be object keys here; analyzeBase folds this list back into a map.
    fieldPurposes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { field: { type: 'string' }, purpose: { type: 'string' } },
        required: ['field', 'purpose'],
        additionalProperties: false,
      },
    },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'antiPatterns', 'fieldPurposes', 'suggestions'],
  additionalProperties: false,
};

const ANALYZE_WORKSPACE_SCHEMA = {
  type: 'object',
  properties: {
    healthScore: { type: 'integer' },
    healthLabel: { type: 'string', enum: ['Excellent', 'Good', 'Fair', 'Needs Attention', 'Critical'] },
    topIssues: { type: 'array', items: { type: 'string' } },
    relationshipQuality: { type: 'string' },
    redundancies: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'healthScore',
    'healthLabel',
    'topIssues',
    'relationshipQuality',
    'redundancies',
    'recommendations',
  ],
  additionalProperties: false,
};

/**
 * Send a message to the Anthropic API and return the parsed response.
 * @param {string} prompt - The user prompt to send
 * @param {string} apiKey - Anthropic API key
 * @param {string} systemPrompt - Optional system prompt
 * @param {Object} [schema] - Optional JSON schema to force a structured JSON reply
 * @returns {Promise<string>} The assistant's text response
 */
async function callClaude(prompt, apiKey, systemPrompt = '', schema = null) {
  const body = {
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  if (schema) {
    body.output_config = { format: { type: 'json_schema', schema } };
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    if (response.status === 401) {
      throw new Error('Invalid API key. Please check your Anthropic API key in Settings.');
    }
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }
    throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

  // Extract text from the response content blocks
  const textBlock = data.content?.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('No text content in API response');
  }

  return textBlock.text;
}

/**
 * Check if a cached result is still valid.
 * @param {Object} cached - The cached result with a timestamp
 * @returns {boolean}
 */
function isCacheValid(cached) {
  if (!cached || !cached.timestamp) return false;
  return Date.now() - cached.timestamp < CACHE_TTL_MS;
}

/**
 * Analyze a single base schema with AI.
 * @param {Object} baseSchema - Parsed schema JSON for the base
 * @param {string} apiKey - Anthropic API key
 * @param {Object} database - Database module for caching
 * @param {string} baseId - Base ID for cache key
 * @returns {Promise<Object>} Analysis result
 */
async function analyzeBase(baseSchema, apiKey, database, baseId) {
  // Check cache
  if (database) {
    const cacheKey = `ai_analysis_base_${baseId}`;
    const cached = database.getSetting(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (isCacheValid(parsed)) {
          return { ...parsed.data, fromCache: true, cachedAt: parsed.timestamp };
        }
      } catch (err) {
        logger.warn('AI', 'Malformed cache for base analysis, running fresh analysis:', err.message);
      }
    }
  }

  // Prepare a condensed version of the schema to stay within reasonable token limits
  const condensed = {
    tables: (baseSchema.tables || []).map((t) => ({
      name: t.name,
      fields: (t.fields || []).map((f) => ({
        name: f.name,
        type: f.type,
        ...(f.options?.linkedTableId ? { linkedTableId: f.options.linkedTableId } : {}),
        ...(f.options?.formulaTextParsed ? { formula: f.options.formulaTextParsed } : {}),
      })),
    })),
  };

  const prompt = `Analyze this Airtable base schema. Provide a 2-3 sentence documentation summary of what this base appears to be used for, a list of detected anti-patterns or design issues, a guessed purpose for each field (field named as "tableName.fieldName"), and actionable improvement suggestions.

Schema:
${JSON.stringify(condensed, null, 2)}`;

  const systemPrompt =
    'You are an expert Airtable consultant analyzing database schemas. Be specific, practical, and concise. Focus on actionable insights.';

  const responseText = await callClaude(prompt, apiKey, systemPrompt, ANALYZE_BASE_SCHEMA);
  const parsed = JSON.parse(responseText);
  const result = {
    ...parsed,
    fieldPurposes: Object.fromEntries(parsed.fieldPurposes.map(({ field, purpose }) => [field, purpose])),
  };

  // Cache the result
  if (database && baseId) {
    const cacheKey = `ai_analysis_base_${baseId}`;
    database.setSetting(cacheKey, JSON.stringify({ data: result, timestamp: Date.now() }));
  }

  return { ...result, fromCache: false, cachedAt: Date.now() };
}

/**
 * Analyze the entire workspace with AI.
 * @param {Array} allBases - All bases with schema data
 * @param {Array} relationships - All detected relationships
 * @param {string} apiKey - Anthropic API key
 * @param {Object} database - Database module for caching
 * @returns {Promise<Object>} Workspace analysis
 */
async function analyzeWorkspace(allBases, relationships, apiKey, database) {
  // Check cache
  if (database) {
    const cached = database.getSetting('ai_analysis_workspace');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (isCacheValid(parsed)) {
          return { ...parsed.data, fromCache: true, cachedAt: parsed.timestamp };
        }
      } catch (err) {
        logger.warn('AI', 'Malformed cache for workspace analysis, running fresh analysis:', err.message);
      }
    }
  }

  // Build a condensed workspace overview
  const overview = {
    totalBases: allBases.length,
    bases: allBases.map((b) => {
      let schema = null;
      try {
        schema = typeof b.schemaJson === 'string' ? JSON.parse(b.schemaJson) : b.schemaJson;
      } catch (err) {
        logger.warn('AI', `Malformed schemaJson for base "${b.name}":`, err.message);
      }
      return {
        name: b.name,
        tableCount: b.tableCount || 0,
        fieldCount: b.fieldCount || 0,
        tables: schema?.tables?.map((t) => t.name) || [],
      };
    }),
    relationships: relationships.map((r) => ({
      source: allBases.find((b) => b.id === r.sourceBaseId)?.name || r.sourceBaseId,
      target: allBases.find((b) => b.id === r.targetBaseId)?.name || r.targetBaseId,
      confidence: r.confidence,
      type: r.type || 'unknown',
    })),
  };

  const prompt = `Analyze this Airtable workspace. Provide a health score from 1-100, a health label (Excellent, Good, Fair, Needs Attention, or Critical), the most important issues or risks, an assessment of how well the bases are connected and organized, any detected redundancy such as duplicate tables or overlapping data, and the top 3-5 strategic recommendations for this workspace.

Workspace overview:
${JSON.stringify(overview, null, 2)}`;

  const systemPrompt =
    'You are an expert Airtable workspace architect reviewing a multi-base workspace. Score health based on organization, relationships, naming, and complexity. Be specific and practical.';

  const responseText = await callClaude(prompt, apiKey, systemPrompt, ANALYZE_WORKSPACE_SCHEMA);
  const result = JSON.parse(responseText);

  // Cache the result
  if (database) {
    database.setSetting('ai_analysis_workspace', JSON.stringify({ data: result, timestamp: Date.now() }));
  }

  return { ...result, fromCache: false, cachedAt: Date.now() };
}

/**
 * Generate clean Markdown documentation for a single base.
 * @param {Object} baseSchema - Parsed schema JSON
 * @param {string} apiKey - Anthropic API key
 * @param {Object} database - Database module for caching
 * @param {string} baseId - Base ID for cache key
 * @returns {Promise<Object>} Documentation result
 */
async function generateDocumentation(baseSchema, apiKey, database, baseId) {
  // Check cache
  if (database && baseId) {
    const cacheKey = `ai_docs_base_${baseId}`;
    const cached = database.getSetting(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (isCacheValid(parsed)) {
          return { markdown: parsed.data, fromCache: true, cachedAt: parsed.timestamp };
        }
      } catch (err) {
        logger.warn('AI', 'Malformed cache for documentation, regenerating:', err.message);
      }
    }
  }

  const condensed = {
    tables: (baseSchema.tables || []).map((t) => ({
      name: t.name,
      description: t.description || '',
      fields: (t.fields || []).map((f) => ({
        name: f.name,
        type: f.type,
        description: f.description || '',
      })),
    })),
  };

  const prompt = `Generate clean Markdown documentation for this Airtable base schema. Include:
- A title and overview paragraph
- A section for each table with a description of its purpose
- A table of fields for each table (Field Name | Type | Purpose)
- A "Relationships" section if any linked record fields exist
- Keep it professional and concise

Schema:
${JSON.stringify(condensed, null, 2)}

Return ONLY the Markdown content, nothing else.`;

  const systemPrompt =
    'You are a technical writer creating documentation for an Airtable database. Write clear, professional documentation in Markdown format.';

  const markdown = await callClaude(prompt, apiKey, systemPrompt);

  // Cache
  if (database && baseId) {
    const cacheKey = `ai_docs_base_${baseId}`;
    database.setSetting(cacheKey, JSON.stringify({ data: markdown, timestamp: Date.now() }));
  }

  return { markdown, fromCache: false, cachedAt: Date.now() };
}

/**
 * Test if an API key is valid by making a minimal API call.
 * @param {string} apiKey
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function testApiKey(apiKey) {
  try {
    await callClaude('Reply with just the word "ok".', apiKey);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  analyzeBase,
  analyzeWorkspace,
  generateDocumentation,
  testApiKey,
};
