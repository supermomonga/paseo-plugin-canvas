import {
  useQuery,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { output as ZodOutput, ZodType } from "zod";
import type { PluginRpcContract } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";

/** The input `useRpc` accepts; the SDK does not export this type. */
type RpcCallInput<
  InputSchema extends ZodType,
  OutputSchema extends ZodType,
> = Parameters<ReturnType<typeof useRpc<InputSchema, OutputSchema>>>[0];

export type RpcQueryOptions<Output> = Omit<
  UseQueryOptions<Output, Error, Output, readonly unknown[]>,
  "queryKey" | "queryFn"
>;

/**
 * Reads an RPC through the host's React Query client. The key is
 * `[contract.name, input]`; `client/updates.ts` and the review cache rely on it.
 */
export function useRpcQuery<
  InputSchema extends ZodType,
  OutputSchema extends ZodType,
>(
  contract: PluginRpcContract<InputSchema, OutputSchema>,
  input: RpcCallInput<InputSchema, OutputSchema>,
  options?: RpcQueryOptions<ZodOutput<OutputSchema>>,
): UseQueryResult<ZodOutput<OutputSchema>, Error> {
  const call = useRpc(contract);
  return useQuery({
    queryKey: [contract.name, input],
    queryFn: () => call(input),
    ...options,
  });
}
