import type { EdgeConfig } from "./src/shared/config";

export declare const resolveConfig: (
  stageConfig: unknown,
  handlerNames: string[],
) => { errors: string[]; handlers: Record<string, EdgeConfig> };
