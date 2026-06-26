import {
  createChannel,
  each,
  type Operation,
  race,
  resource,
  spawn,
  type Stream,
  until,
} from "effection";
import { stdin } from "node:process";

// Bridge Node's process.stdin (raw bytes) into an Effection Stream.
export function useStdin(): Operation<Stream<Uint8Array, void>> {
  return resource(function* (provide) {
    const channel = createChannel<Uint8Array, void>();

    const iterator = stdin[Symbol.asyncIterator]();

    yield* spawn(function* () {
      let next = yield* until(iterator.next());
      while (!next.done) {
        yield* channel.send(next.value);
        next = yield* until(iterator.next());
      }
      yield* channel.close();
    });

    yield* race([provide(channel), drain(channel)]);
  });
}

function* drain<T, TClose>(stream: Stream<T, TClose>): Operation<void> {
  for (const _ of yield* each(stream)) {
    yield* each.next();
  }
}
