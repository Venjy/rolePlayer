export type RealtimeErrorAction =
  | "show_launch_error"
  | "show_session_message"
  | "reconnect_session";

/**
 * Routes errors by lifecycle phase rather than by transport severity alone.
 * Until a conversation first reaches `session.ready`, startup failure returns
 * to the launcher. After that first readiness, recoverable turn errors stay on
 * the current socket and fatal runtime errors rebuild that same durable
 * conversation on a fresh socket—even if a replacement socket is still
 * initializing when it fails.
 */
export function selectRealtimeErrorAction(input: {
  conversationStarted: boolean;
  recoverable: boolean;
}): RealtimeErrorAction {
  if (!input.conversationStarted) return "show_launch_error";
  return input.recoverable ? "show_session_message" : "reconnect_session";
}
