import { put } from '@vercel/blob';

export async function uploadCartImage(png: Buffer, checkoutToken: string): Promise<string> {
  const blob = await put(`cart/${checkoutToken}.png`, png, {
    access: 'public',
    contentType: 'image/png',
    addRandomSuffix: false,
  });
  return blob.url;
}
