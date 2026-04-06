import { init } from "iii-sdk";
import type {
  IState,
  StateGetInput,
  StateSetInput,
  StateListInput,
  StateUpdateInput,
  StateDeleteInput,
} from "iii-sdk/state";

const engineUrl = process.env.III_BRIDGE_URL ?? "ws://localhost:49134";

export const iii = init(engineUrl, {
  otel: { enabled: true, serviceName: "terminus-iii", metricsEnabled: true },
});

export const state: IState = {
  get: <T>(i: StateGetInput) => iii.trigger("state::get", i) as Promise<T | null>,
  set: <T>(i: StateSetInput) => iii.trigger("state::set", i),
  delete: (i: StateDeleteInput) => iii.trigger("state::delete", i),
  list: <T>(i: StateListInput) => iii.trigger("state::list", i) as Promise<T[]>,
  update: <T>(i: StateUpdateInput) => iii.trigger("state::update", i),
};

export const emit = (topic: string, data: unknown) =>
  iii.triggerVoid("publish", { topic, data });

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export const useApi = (
  path: string,
  method: HttpMethod,
  handler: (req: ApiRequest) => Promise<ApiResponse>,
  description?: string,
) => {
  const id = `api::${method.toLowerCase()}::${path}`;
  iii.registerFunction({ id, description }, handler);
  iii.registerTrigger({ type: "http", function_id: id, config: { api_path: path, http_method: method, description } });
};

let idCounter = 0;

export const useCron = (
  expression: string,
  handler: () => Promise<void>,
  description?: string,
) => {
  const id = `cron::${expression.replace(/\s+/g, "_").replace(/\*/g, "x")}::${++idCounter}`;
  iii.registerFunction({ id, description }, handler);
  iii.registerTrigger({ type: "cron", function_id: id, config: { expression } });
};

export const useEvent = (
  topic: string,
  handler: (data: unknown) => Promise<void>,
  description?: string,
) => {
  const id = `event::${topic}::${++idCounter}`;
  iii.registerFunction({ id, description }, handler);
  iii.registerTrigger({ type: "subscribe", function_id: id, config: { topic } });
};

export interface ApiRequest {
  headers?: Record<string, string>;
  params?: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export const now = () => new Date().toISOString();

export const paramId = (req: ApiRequest) => req.params?.id ?? "";

export const ok = <T>(data: T): ApiResponse => ({ status: 200, body: { data } });
export const created = <T>(data: T): ApiResponse => ({ status: 201, body: { data } });
export const notFound = (name = "Resource"): ApiResponse => ({ status: 404, body: { error: `${name} not found` } });
export const deleted = (): ApiResponse => ({ status: 204 });
export const badRequest = (error: string): ApiResponse => ({ status: 400, body: { error } });

export const API_URI = process.env.API_URI || "http://localhost:3111";
