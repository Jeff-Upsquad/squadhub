import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { fetchR2ObjectAsBase64 } from '../r2';

// Lazy-initialized so importing this module doesn't crash when the API key
// is missing — boot still succeeds and only the analyze endpoint 503s.
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

export type EntryKind = 'cash' | 'expense' | 'check';
export type AnalysisStatus = 'success' | 'failed';

export interface AnalysisInputImage {
  object_key: string;
  public_url: string;
  original_filename: string;
}

export interface AnalysisExtracted {
  entry_type?: string;
  amount?: number;
  entry_date?: string;
  description?: string;
  party_name?: string;
  payment_mode?: string;
  category_suggestion?: string;
  nature_of_expense?: string;
  check_number?: string;
  bank_name?: string;
}

export interface AnalysisResult {
  object_key: string;
  status: AnalysisStatus;
  entry_kind: EntryKind;
  extracted: AnalysisExtracted;
  error_message?: string;
}

const SYSTEM_PROMPT = [
  'You are a receipt and financial document analyzer for an Indian small-business cash book app.',
  'Given a single image, extract transaction details and classify it into one of three kinds:',
  '  - "cash": general cash transactions (cash receipts, informal IOUs, payment slips)',
  '  - "expense": business expense receipts (purchases, bills, services rendered to the business)',
  '  - "check": cheque/bank check images',
  'Always call the extract_receipt tool exactly once with your best extraction.',
  'If the image is unreadable or not a receipt at all, still call the tool but leave fields blank and set entry_kind to "expense" by default.',
  'Dates must be ISO format YYYY-MM-DD. If no date is visible, use today.',
  'Amounts are numbers in INR — strip currency symbols and thousand separators.',
  'For "cash" kind, entry_type is "cash_in" (received) or "cash_out" (paid).',
  'For "expense" kind, entry_type is "expense_out" (the usual case) or "expense_in" (refund).',
  'For "check" kind, entry_type is "collection" (received from someone) or "deposit" (going to bank).',
  'payment_mode must be one of: cash, upi, bank_transfer, cheque, other.',
].join(' ');

const TOOL_DEFINITION = {
  name: 'extract_receipt',
  description: 'Extract structured transaction details from a receipt image.',
  input_schema: {
    type: 'object',
    properties: {
      entry_kind: {
        type: 'string',
        enum: ['cash', 'expense', 'check'],
        description: 'The type of entry this image represents.',
      },
      entry_type: {
        type: 'string',
        description: 'cash_in/cash_out for cash; expense_out/expense_in for expense; collection/deposit for check.',
      },
      amount: { type: 'number', description: 'Transaction amount in INR (no currency symbol).' },
      entry_date: { type: 'string', description: 'ISO date YYYY-MM-DD.' },
      description: { type: 'string', description: 'Brief description of what the transaction is for.' },
      party_name: { type: 'string', description: 'Vendor, customer, or counterparty name.' },
      payment_mode: {
        type: 'string',
        enum: ['cash', 'upi', 'bank_transfer', 'cheque', 'other'],
      },
      category_suggestion: {
        type: 'string',
        description: 'A short category label (e.g., "Office Supplies", "Fuel", "Rent").',
      },
      nature_of_expense: {
        type: 'string',
        description: 'For expense kind only — short label of what was spent on.',
      },
      check_number: { type: 'string', description: 'For check kind only.' },
      bank_name: { type: 'string', description: 'For check kind only.' },
    },
    required: ['entry_kind'],
  },
} as const;

function mediaTypeFor(contentType: string): 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' {
  if (contentType.includes('png')) return 'image/png';
  if (contentType.includes('gif')) return 'image/gif';
  if (contentType.includes('webp')) return 'image/webp';
  return 'image/jpeg';
}

async function analyzeOne(image: AnalysisInputImage): Promise<AnalysisResult> {
  try {
    const { base64, contentType } = await fetchR2ObjectAsBase64(image.object_key);

    const message = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [TOOL_DEFINITION as never],
      tool_choice: { type: 'tool', name: 'extract_receipt' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaTypeFor(contentType),
                data: base64,
              },
            },
            { type: 'text', text: 'Extract the transaction details from this image.' },
          ],
        },
      ],
    });

    const toolUse = message.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      return {
        object_key: image.object_key,
        status: 'failed',
        entry_kind: 'expense',
        extracted: {},
        error_message: 'Model did not return tool_use block',
      };
    }

    const input = toolUse.input as AnalysisExtracted & { entry_kind: EntryKind };
    return {
      object_key: image.object_key,
      status: 'success',
      entry_kind: input.entry_kind || 'expense',
      extracted: {
        entry_type: input.entry_type,
        amount: typeof input.amount === 'number' ? input.amount : undefined,
        entry_date: input.entry_date,
        description: input.description,
        party_name: input.party_name,
        payment_mode: input.payment_mode,
        category_suggestion: input.category_suggestion,
        nature_of_expense: input.nature_of_expense,
        check_number: input.check_number,
        bank_name: input.bank_name,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Analysis failed';
    return {
      object_key: image.object_key,
      status: 'failed',
      entry_kind: 'expense',
      extracted: {},
      error_message: message,
    };
  }
}

// Process all images in parallel with a small concurrency cap to stay
// well under Anthropic's per-minute rate limits and avoid burying the
// event loop with 50+ simultaneous downloads.
const MAX_CONCURRENT = 5;

export async function analyzeReceiptImages(
  images: AnalysisInputImage[],
): Promise<AnalysisResult[]> {
  const results: AnalysisResult[] = new Array(images.length);
  let cursor = 0;

  async function worker() {
    while (cursor < images.length) {
      const i = cursor++;
      results[i] = await analyzeOne(images[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT, images.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
