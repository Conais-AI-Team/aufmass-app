import { motion } from 'framer-motion';
import { MARKETING_SOURCES } from '../utils/marketingSources';
import './GrunddatenSection.css';
import './SectionStyles.css';

interface GrunddatenSectionProps {
  formData: {
    datum: string;
    aufmasser: string;
    kundeVorname: string;
    kundeNachname: string;
    kundeEmail?: string;
    kundeTelefon?: string;
    kundenlokation: string;
    marketingSource?: string | null;
  };
  updateField: (field: string, value: string) => void;
}

const GrunddatenSection = ({ formData, updateField }: GrunddatenSectionProps) => {
  return (
    <div className="grunddaten-section">
      <motion.div
        className="section-header"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <h2>Grunddaten</h2>
        <p className="section-description">Allgemeine Informationen zum Aufmaß</p>
      </motion.div>

      <div className="form-grid">
        <motion.div
          className="form-group full-width"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <label htmlFor="datum">
            Datum <span className="required">*</span>
          </label>
          <input
            type="date"
            id="datum"
            value={formData.datum}
            onChange={(e) => updateField('datum', e.target.value)}
            required
          />
        </motion.div>

        <motion.div
          className="form-group full-width"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <label htmlFor="aufmasser">
            Aufmasser / Berater <span className="required">*</span>
          </label>
          <input
            type="text"
            id="aufmasser"
            value={formData.aufmasser}
            onChange={(e) => updateField('aufmasser', e.target.value)}
            placeholder="Name des Aufmassers"
            required
          />
        </motion.div>

        <motion.div
          className="form-group"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
        >
          <label htmlFor="kundeVorname">
            Kunde Vorname <span className="required">*</span>
          </label>
          <input
            type="text"
            id="kundeVorname"
            value={formData.kundeVorname}
            onChange={(e) => updateField('kundeVorname', e.target.value)}
            placeholder="Vorname"
            required
          />
        </motion.div>

        <motion.div
          className="form-group"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.4 }}
        >
          <label htmlFor="kundeNachname">
            Kunde Nachname <span className="required">*</span>
          </label>
          <input
            type="text"
            id="kundeNachname"
            value={formData.kundeNachname}
            onChange={(e) => updateField('kundeNachname', e.target.value)}
            placeholder="Nachname"
            required
          />
        </motion.div>

        <motion.div
          className="form-group"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.45 }}
        >
          <label htmlFor="kundeEmail">
            Kunde E-Mail <span className="required">*</span>
          </label>
          <input
            type="email"
            id="kundeEmail"
            value={formData.kundeEmail || ''}
            onChange={(e) => updateField('kundeEmail', e.target.value)}
            placeholder="kunde@beispiel.de"
            required
          />
        </motion.div>

        <motion.div
          className="form-group"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.47 }}
        >
          <label htmlFor="kundeTelefon">
            Kunde Telefon <span className="required">*</span>
          </label>
          <input
            type="tel"
            id="kundeTelefon"
            value={formData.kundeTelefon || ''}
            onChange={(e) => updateField('kundeTelefon', e.target.value)}
            placeholder="+49 123 456789"
            required
          />
        </motion.div>

        <motion.div
          className="form-group full-width"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.5 }}
        >
          <label htmlFor="kundenlokation">
            Kundenlokation / Adresse <span className="required">*</span>
          </label>
          <input
            type="text"
            id="kundenlokation"
            value={formData.kundenlokation}
            onChange={(e) => updateField('kundenlokation', e.target.value)}
            placeholder="Adresse oder Standort"
            required
          />
        </motion.div>

        <motion.div
          className="form-group full-width"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.55 }}
        >
          <label htmlFor="marketingSource">
            Wie sind Sie auf uns aufmerksam geworden?
          </label>
          <select
            id="marketingSource"
            value={formData.marketingSource || ''}
            onChange={(e) => updateField('marketingSource', e.target.value)}
          >
            <option value="">Bitte auswählen...</option>
            {MARKETING_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </motion.div>
      </div>
    </div>
  );
};

export default GrunddatenSection;
