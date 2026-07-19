// Modül F: PDF Pipeline orchestrator
// Composes Cover + ProductDetail + Main Content + AGB into a single PDF
import type { jsPDF } from 'jspdf';
import { drawCoverPage, type CoverData } from './pdfCover';
import { drawProductDetailPage, type ProductDetailData } from './pdfProductDetail';
import { drawAgbPages } from './pdfAgb';
import { loadAyluxPdfLogo } from '../pdfLogo';

export interface PipelineConfig {
  cover?: CoverData;
  productDetail?: ProductDetailData;
  agb?: { content: string };
  drawMainContent: (pdf: jsPDF) => Promise<void> | void;
}

export async function executePdfPipeline(pdf: jsPDF, config: PipelineConfig): Promise<void> {
  if (config.cover) {
    drawCoverPage(pdf, { ...config.cover, brandLogo: config.cover.brandLogo ?? await loadAyluxPdfLogo() });
  }
  if (config.productDetail) {
    drawProductDetailPage(pdf, config.productDetail);
  }

  await config.drawMainContent(pdf);

  if (config.agb && config.agb.content?.trim()) {
    drawAgbPages(pdf, config.agb.content);
  }
}
