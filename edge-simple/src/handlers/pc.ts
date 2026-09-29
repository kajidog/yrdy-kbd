import { createAuthHandler } from "../auth";
import { CLIENT_IDS } from "../config";

export const handler = createAuthHandler(CLIENT_IDS.pc);
