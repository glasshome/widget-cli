import { isCancel } from "@clack/prompts";

/**
 * `isCancel` is typed `value is typeof CANCEL_SYMBOL` while the prompts return
 * `string | symbol`, so excluding one unique symbol narrows nothing.
 */
export function cancelled(value: unknown): value is symbol {
  return isCancel(value);
}
