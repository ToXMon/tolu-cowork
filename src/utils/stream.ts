/**
 * @tolu/cowork-core — Streaming helpers for AsyncGenerator pipelines
 */

 import type { ToluStreamEvent } from '../types/index.js';

 /**
  * Transform an AsyncGenerator of arbitrary items into JSON-lines strings.
  * Each yielded item is serialized as a single JSON line terminated with `\n`.
  */
 export async function* toJsonLines<T>(stream: AsyncGenerator<T>): AsyncGenerator<string> {
   for await (const item of stream) {
     yield JSON.stringify(item) + '\n';
   }
 }

 /**
  * Collect all events from an AsyncGenerator into an array.
  * Consumes the entire generator before returning.
  */
 export async function collectStream<T>(stream: AsyncGenerator<T>): Promise<T[]> {
   const items: T[] = [];
   for await (const item of stream) {
     items.push(item);
   }
   return items;
 }

 /**
  * Create a Web-API ReadableStream from an AsyncGenerator.
  * Useful for piping generator output into Response bodies or other streams.
  */
 export function toReadableStream<T>(gen: AsyncGenerator<T>): ReadableStream<T> {
   const iterator = gen[Symbol.asyncIterator]();

   return new ReadableStream<T>({
     async pull(controller) {
       try {
         const { value, done } = await iterator.next();
         if (done) {
           controller.close();
         } else {
           controller.enqueue(value);
         }
       } catch (err) {
         controller.error(err);
       }
     },

     async cancel() {
       await iterator.return?.(undefined);
     },
   });
 }

 /**
  * Pipe an AsyncGenerator into a WritableStream.
  * Resolves when the generator is exhausted and all writes complete.
  */
 export async function pipeToWritable<T>(gen: AsyncGenerator<T>, writable: WritableStream<T>): Promise<void> {
   const reader = toReadableStream(gen).getReader();
   const writer = writable.getWriter();

   try {
     while (true) {
       const { value, done } = await reader.read();
       if (done) break;
       await writer.write(value);
     }
   } finally {
     writer.releaseLock();
     reader.releaseLock();
   }
 }
