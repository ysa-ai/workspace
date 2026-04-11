import { isAgentConnected, getAgentUserId, sendAgentCommand } from "./handler";

export { isAgentConnected };
export { sendAgentCommand as sendCommand };

export function isAgentConnectedForUser(userId: number): boolean {
  return isAgentConnected() && getAgentUserId() === userId;
}
