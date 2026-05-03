import { getBranchTerms, type BranchTerms } from '../services/api';

let cached: BranchTerms | null = null;
let fetchPromise: Promise<BranchTerms | null> | null = null;

export const getCachedBranchTerms = async (): Promise<BranchTerms | null> => {
  if (cached) return cached;
  if (!fetchPromise) {
    fetchPromise = getBranchTerms()
      .then((data) => { cached = data; return data; })
      .catch((err) => {
        console.warn('Could not fetch branch terms:', err);
        return null;
      });
  }
  return fetchPromise;
};

export const invalidateBranchTermsCache = () => {
  cached = null;
  fetchPromise = null;
};
