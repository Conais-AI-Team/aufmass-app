export type FieldType = 'text' | 'number' | 'select' | 'radio' | 'checkbox' | 'boolean' | 'textarea' | 'fundament' | 'bauform' | 'conditional' | 'modelColorSelect' | 'markise_trigger' | 'multiselect' | 'seitenmarkise' | 'ja_nein' | 'senkrecht_section' | 'festes_element_section' | 'schiebe_element_section' | 'keil_fenster_section';

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  options?: string[];
  unit?: string;
  required: boolean;
  placeholder?: string;
  hasCustomOption?: boolean;
  conditionalType?: string;
  valueUnit?: string;
  valueLabel?: string;
  allowZero?: boolean;
  positions?: string[];
  models?: string[];
  excludeModels?: string[];
  conditionalField?: {
    trigger: string;
    field: string;
    type: string;
    unit?: string;
    label: string;
  };
  showWhen?: {
    field: string;
    value?: string;
    notEquals?: string;
  };
}

export interface ProductTypeConfig {
  models: string[];
  fields: FieldConfig[];
}

export interface CategoryConfig {
  [productType: string]: ProductTypeConfig;
}

export interface ProductConfig {
  [category: string]: CategoryConfig;
}

export interface ProductSelection {
  category: string;
  productType: string;
  model: string | string[];
}

export interface DynamicFormData {
  [fieldName: string]: string | number | boolean | string[];
}
