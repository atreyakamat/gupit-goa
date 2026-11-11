import {
  EXTRACTION_TOOL_NAME,
  SYSTEM_PROMPT,
  buildUserPrompt,
  extractionJsonSchema,
} from '../extraction/prompt';
import type { Extractor } from '../types';
import { ProviderError } from './search';

/**
 * DEVELOPMENT STUB. Extracts nothing and calls no model. With this extractor the worker
 * fetches permitted pages and then records zero candidates: it does not fake output.
 */
export function createStubExtractor(): Extractor {
  return {
    name: 'stub',
    async extract() {
      return { raw: { candidates: [] }, usage: null };
    },
  };
}

/**
 * Anthropic Messages API with a forced tool call for structured output.
 * The model's output is still untrusted: the caller validates it against the zod schema.
 */
export function createAnthropicExtractor(options: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): Extractor {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    name: `anthropic:${options.model}`,
    async extract(page, context) {
      let response: Response;
      try {
        response = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: AbortSignal.timeout(90_000),
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            tools: [
              {
                name: EXTRACTION_TOOL_NAME,
                description:
                  'Record the candidate places found on the page. Use null for anything the page does not state.',
                input_schema: extractionJsonSchema,
              },
            ],
            tool_choice: { type: 'tool', name: EXTRACTION_TOOL_NAME },
            messages: [{ role: 'user', content: buildUserPrompt(page, context) }],
          }),
        });
      } catch (error) {
        throw new ProviderError('unavailable', `Model request failed: ${String(error)}`, true);
      }
      if (response.status === 429 || response.status === 529)
        throw new ProviderError('quota_exhausted', 'Model rate limit or overload', true);
      if (response.status === 401 || response.status === 403)
        throw new ProviderError('unauthorized', 'Model API key rejected', false);
      if (!response.ok)
        throw new ProviderError(
          'unavailable',
          `Model returned ${response.status}`,
          response.status >= 500,
        );

      const body = (await response.json()) as {
        content?: { type?: string; name?: string; input?: unknown }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const call = body.content?.find(
        (block) => block.type === 'tool_use' && block.name === EXTRACTION_TOOL_NAME,
      );
      if (!call)
        throw new ProviderError('bad_response', 'Model did not return structured output', true);
      return {
        raw: call.input,
        usage: {
          inputTokens: body.usage?.input_tokens ?? 0,
          outputTokens: body.usage?.output_tokens ?? 0,
        },
      };
    },
  };
}
