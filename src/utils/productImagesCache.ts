import { getProductImages, type ProductImage } from '../services/api';

const cache = new Map<number, ProductImage[]>();

export const getCachedProductImages = async (productId: number): Promise<ProductImage[]> => {
  if (cache.has(productId)) return cache.get(productId)!;
  const images = await getProductImages(productId);
  cache.set(productId, images);
  return images;
};

export const invalidateProductImagesCache = (productId?: number) => {
  if (productId !== undefined) cache.delete(productId);
  else cache.clear();
};

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Cache base64 strings + in-flight promises so repeated calls (e.g. split-per-product
// generates one PDF per item, all referencing the same product images) don't refetch.
const base64Cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string | undefined>>();

export const fetchImageAsBase64 = async (filename: string): Promise<string | undefined> => {
  const cached = base64Cache.get(filename);
  if (cached) return cached;
  const pending = inFlight.get(filename);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const url = `${API_BASE_URL}/product-image/${filename}`;
      const response = await fetch(url);
      if (!response.ok) return undefined;
      const blob = await response.blob();
      const dataUrl = await new Promise<string | undefined>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(undefined);
        reader.readAsDataURL(blob);
      });
      if (dataUrl) base64Cache.set(filename, dataUrl);
      return dataUrl;
    } catch {
      return undefined;
    } finally {
      inFlight.delete(filename);
    }
  })();

  inFlight.set(filename, promise);
  return promise;
};

export const invalidateImageBase64Cache = (filename?: string) => {
  if (filename !== undefined) base64Cache.delete(filename);
  else base64Cache.clear();
};
