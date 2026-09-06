// src/chat/send-message.dto.spec.ts
import { ValidationPipe } from '@nestjs/common';
import { SendMessageDto } from './dto/send-message.dto';

/** The app's global pipe config, so these match production behaviour. */
const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
});

const run = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: SendMessageDto });

describe('SendMessageDto', () => {
  it('accepts an ordinary message', async () => {
    await expect(run({ text: 'See everyone at 7pm' })).resolves.toEqual({
      text: 'See everyone at 7pm',
    });
  });

  it('trims surrounding whitespace', async () => {
    const out: any = await run({ text: '  hello  ' });

    expect(out.text).toBe('hello');
  });

  it('rejects a whitespace-only message', async () => {
    // Trimming happens BEFORE validation precisely so this fails rather than
    // storing a blank message that renders as an empty bubble.
    await expect(run({ text: '     ' })).rejects.toThrow();
  });

  it('rejects an empty string', async () => {
    await expect(run({ text: '' })).rejects.toThrow();
  });

  it('rejects a missing text field', async () => {
    await expect(run({})).rejects.toThrow();
  });

  it('rejects a non-string', async () => {
    await expect(run({ text: 42 })).rejects.toThrow();
  });

  it('accepts exactly 2000 characters', async () => {
    await expect(run({ text: 'x'.repeat(2000) })).resolves.toBeDefined();
  });

  it('rejects 2001 characters', async () => {
    // Bounded so one client cannot write an unbounded document.
    await expect(run({ text: 'x'.repeat(2001) })).rejects.toThrow();
  });

  it('rejects unknown properties', async () => {
    // forbidNonWhitelisted is global; senderId in particular must never be
    // caller-supplied — it comes from the authenticated user.
    await expect(
      run({ text: 'hi', senderId: 'someone-else' }),
    ).rejects.toThrow();
  });

  it('keeps newlines inside the message', async () => {
    // Only the ENDS are trimmed; a multi-line message is legitimate.
    const out: any = await run({ text: 'line one\nline two' });

    expect(out.text).toBe('line one\nline two');
  });
});
