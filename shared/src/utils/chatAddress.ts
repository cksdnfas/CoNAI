/**
 * The app labels every history line it shows a model with that message's address: `[message_id=12; to=["user"];
 * reply_to=11; from=3]` in direct chats, `[Name; message_id=12; to=[3]]` in rooms. Models sometimes copy the label
 * into their own reply. It is never part of the text: the reader would see it, and the translator treats a
 * bracketed line start as a `[Name]` speaker tag that must survive translation, so the echoed label made the
 * translation drop.
 */
const ECHOED_ADDRESS = /^[ \t]*(?:\*\*)?\[(?:[^[\]\n]*?;\s*)?message_id=\d+(?:[^[\]\n]|\[[^[\]\n]*\])*\](?:\*\*)?[ \t]*:?[ \t]*\n?/gm

/** The reply without any address label the model wrote at the start of a line. */
export function stripEchoedAddresses(text: string) {
  return text.replace(ECHOED_ADDRESS, '')
}
