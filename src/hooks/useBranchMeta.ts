import { useEffect, useState } from 'react';

interface BranchInfo {
  slug: string;
  name: string;
  title: string;
}

const branchConfig: Record<string, BranchInfo> = {
  koblenz: {
    slug: 'koblenz',
    name: 'Koblenz',
    title: 'AYLUX Koblenz - Aufmaß System'
  },
  dortmund: {
    slug: 'dortmund',
    name: 'Dortmund',
    title: 'AYLUX Dortmund - Aufmaß System'
  },
  berlin: {
    slug: 'berlin',
    name: 'Berlin',
    title: 'AYLUX Berlin - Aufmaß System'
  }
};

const defaultBranch: BranchInfo = {
  slug: 'dev',
  name: 'Development',
  title: 'AYLUX Aufmaß System'
};

function detectBranch(): BranchInfo {
  const hostname = window.location.hostname;

  // Check for branch subdomain: {branch}.cnsform.com
  const match = hostname.match(/^([a-z0-9-]+)\.cnsform\.com$/i) || hostname.match(/^([a-z0-9-]+)\.localhost$/i);
  if (match) {
    const slug = match[1].toLowerCase();
    return branchConfig[slug] || { slug, name: slug.charAt(0).toUpperCase() + slug.slice(1), title: `AYLUX ${slug.charAt(0).toUpperCase() + slug.slice(1)} - Aufmaß System` };
  }

  // Dev/localhost
  return defaultBranch;
}

export function useBranchMeta() {
  const [branch, setBranch] = useState<BranchInfo>(defaultBranch);

  useEffect(() => {
    const detectedBranch = detectBranch();
    setBranch(detectedBranch);

    // Update document title
    document.title = detectedBranch.title;

    // Update manifest dynamically (for PWA)
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      // Could create dynamic manifest here if needed
    }
  }, []);

  return branch;
}

export function getBranchSlug(): string | null {
  const hostname = window.location.hostname;
  const match = hostname.match(/^([a-z0-9-]+)\.cnsform\.com$/i) || hostname.match(/^([a-z0-9-]+)\.localhost$/i);
  return match ? match[1].toLowerCase() : null;
}

// Check if current domain is admin branch (can manage all branches)
export function isAdminBranch(): boolean {
  const hostname = window.location.hostname;
  if (hostname.match(/^([a-z0-9-]+)\.cnsform\.com$/i) || hostname.match(/^([a-z0-9-]+)\.localhost$/i)) {
    return false;
  }
  const adminDomains = ['localhost', 'aufmass-api.conais.com', 'aufmass-app.vercel.app'];
  return adminDomains.some(d => hostname === d || hostname.includes(d));
}
