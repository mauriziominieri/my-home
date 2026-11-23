import { GroceryProduct, HomeArticleRecord } from '../types/home';
import { groceryProductToArticlePayload } from '../utils/carGroceryStore';

interface GrocerySeedInput {
  slug: string;
  name: string;
  category: string;
  unit: string;
  priceIns: number | null;
  priceMd: number | null;
  priceConad: number | null;
  inShoppingList?: boolean;
  notes?: string;
}

const RAW_GROCERY_SEED: GrocerySeedInput[] = [
  // Frutta & Verdura
  { slug: 'mele', name: 'Mele', category: 'Frutta & Verdura', unit: '1 kg', priceIns: 1.5, priceMd: 1.59, priceConad: 1.5 },
  { slug: 'banane', name: 'Banane', category: 'Frutta & Verdura', unit: '1 kg', priceIns: 1.29, priceMd: 1.39, priceConad: 1.69 },
  { slug: 'basilico', name: 'Basilico', category: 'Frutta & Verdura', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 36.33 },
  { slug: 'salvia', name: 'Salvia', category: 'Frutta & Verdura', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 36.33 },
  { slug: 'spinaci', name: 'Spinaci', category: 'Frutta & Verdura', unit: '1 kg', priceIns: null, priceMd: 1.98, priceConad: 3.32 },
  { slug: 'fagiolini', name: 'Fagiolini', category: 'Frutta & Verdura', unit: '1 kg', priceIns: 1.99, priceMd: 1.99, priceConad: 2.98 },
  { slug: 'insalata_pezzo', name: 'Insalata (al pezzo)', category: 'Frutta & Verdura', unit: '1 pz', priceIns: 1.39, priceMd: 1.19, priceConad: 2.49, notes: 'MD: 1,19 €/pz (3,40 €/kg)' },
  { slug: 'insalata_kg', name: 'Insalata in busta (al kg)', category: 'Frutta & Verdura', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 6.3 },
  { slug: 'zucchine', name: 'Zucchine', category: 'Frutta & Verdura', unit: '1 kg', priceIns: 1.79, priceMd: 1.69, priceConad: 2.39, notes: "IN'S anche 3,49 €/kg · MD 1,69 € in offerta" },
  { slug: 'melanzane', name: 'Melanzane', category: 'Frutta & Verdura', unit: '1 kg', priceIns: 3.99, priceMd: 1.99, priceConad: 2.89, notes: 'CONAD anche 3,99 €/kg' },
  { slug: 'carote', name: 'Carote', category: 'Frutta & Verdura', unit: '1 kg', priceIns: 1.09, priceMd: 1.78, priceConad: 1.69 },
  { slug: 'cavolo', name: 'Cavolo', category: 'Frutta & Verdura', unit: '1 kg', priceIns: null, priceMd: 1.89, priceConad: 2.29 },
  { slug: 'zucca', name: 'Zucca', category: 'Frutta & Verdura', unit: '1 kg', priceIns: null, priceMd: 1.99, priceConad: 1.99 },
  { slug: 'peperoni', name: 'Peperoni', category: 'Frutta & Verdura', unit: '1 kg', priceIns: 3.49, priceMd: null, priceConad: 3.99 },
  { slug: 'patate', name: 'Patate', category: 'Frutta & Verdura', unit: '1 kg', priceIns: 1.25, priceMd: 1.09, priceConad: 1.5, notes: 'MD: rosse 2 kg a 0,99 €/kg' },
  { slug: 'pomodorini', name: 'Pomodorini', category: 'Frutta & Verdura', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 6.98 },
  { slug: 'rosmarino', name: 'Rosmarino', category: 'Frutta & Verdura', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 67.73 },
  { slug: 'scalogno', name: 'Scalogno', category: 'Frutta & Verdura', unit: '1 kg', priceIns: 3.96, priceMd: null, priceConad: null },

  // Latticini & Uova
  { slug: 'brie', name: 'Brie', category: 'Latticini & Uova', unit: '1 kg', priceIns: null, priceMd: 9.95, priceConad: null },
  { slug: 'burro', name: 'Burro', category: 'Latticini & Uova', unit: '1 kg', priceIns: 7.38, priceMd: 7.98, priceConad: 13.45, notes: "IN'S: 7,38 €/kg (500g) e 7,40 (250g) · MD: 500g offerta" },
  { slug: 'crescenza', name: 'Crescenza', category: 'Latticini & Uova', unit: '1 kg', priceIns: 12.9, priceMd: 6.84, priceConad: 9.9, notes: "IN'S bio" },
  { slug: 'formaggio_spalmabile_light', name: 'Formaggio spalmabile light', category: 'Latticini & Uova', unit: '1 kg', priceIns: 4.95, priceMd: 4.95, priceConad: 10.95, notes: 'MD proteico: 7,37 €/kg' },
  { slug: 'latte', name: 'Latte', category: 'Latticini & Uova', unit: '1 L', priceIns: 1.29, priceMd: 0.79, priceConad: 0.89, notes: 'Formati piccoli scremati: CONAD/MD 1,30 €/L' },
  { slug: 'mascarpone', name: 'Mascarpone', category: 'Latticini & Uova', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 9.96 },
  { slug: 'panna_cucina', name: 'Panna da cucina', category: 'Latticini & Uova', unit: '1 kg', priceIns: 3.95, priceMd: 4.25, priceConad: 4.95 },
  { slug: 'parmigiano', name: 'Parmigiano', category: 'Latticini & Uova', unit: '1 kg', priceIns: 16.45, priceMd: 16.49, priceConad: 17.25, notes: "IN'S intero 17,90 / gratt. 16,45 · MD intero 16,49 / gratt. 19,90" },
  { slug: 'pasta_sfoglia', name: 'Pasta sfoglia', category: 'Latticini & Uova', unit: '1 kg', priceIns: null, priceMd: 3.36, priceConad: null },
  { slug: 'ricotta', name: 'Ricotta', category: 'Latticini & Uova', unit: '1 kg', priceIns: 5.63, priceMd: 4.75, priceConad: 5.95 },
  { slug: 'scamorza_affumicata', name: 'Scamorza affumicata', category: 'Latticini & Uova', unit: '1 kg', priceIns: 8.08, priceMd: 8.63, priceConad: 9.96 },
  { slug: 'sottilette', name: 'Sottilette', category: 'Latticini & Uova', unit: '1 kg', priceIns: null, priceMd: 4.39, priceConad: 6.22, notes: 'MD: confezione da 1kg' },
  { slug: 'uova', name: 'Uova (prezzo al pezzo)', category: 'Latticini & Uova', unit: '1 pz', priceIns: 0.2, priceMd: 0.2, priceConad: 0.45, notes: 'CONAD: 4,51 € (10 pz) · MD: 3,69 € (18 pz = 0,204 €/pz)' },
  { slug: 'yogurt_frutta', name: 'Yogurt alla frutta', category: 'Latticini & Uova', unit: '1 kg', priceIns: 2.47, priceMd: 2.47, priceConad: 3.16 },
  { slug: 'yogurt_greco', name: 'Yogurt greco', category: 'Latticini & Uova', unit: '1 kg', priceIns: 4.58, priceMd: 4.58, priceConad: 4.69 },
  { slug: 'yogurt_sfizio', name: 'Yogurt Sfizio', category: 'Latticini & Uova', unit: '1 kg', priceIns: 5.0, priceMd: 5.0, priceConad: 5.67 },

  // Pasta, Riso & Pane
  { slug: 'crostini', name: 'Crostini', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 7.3 },
  { slug: 'pane_4_cereali', name: 'Pane 4 cereali', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 3.5, priceMd: 3.5, priceConad: 3.58 },
  { slug: 'panini_hamburger', name: 'Panini Hamburger', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 3.17, priceMd: 3.17, priceConad: 3.97 },
  { slug: 'pasta_tortelloni', name: 'Pasta Tortelloni', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 2.59, priceMd: 2.69, priceConad: 6.36 },
  { slug: 'pasta_tortellini', name: 'Pasta Tortellini', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 2.79, priceMd: 3.38, priceConad: 7.56 },
  { slug: 'pasta_gnocchi', name: 'Gnocchi', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 1.3, priceMd: 1.05, priceConad: 1.98 },
  { slug: 'pasta_normale', name: 'Pasta normale', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 1.1, priceMd: 1.1, priceConad: 1.18 },
  { slug: 'pasta_integrale', name: 'Pasta integrale', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: null, priceMd: 1.7, priceConad: 1.7 },
  { slug: 'piadina', name: 'Piadina', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 2.82, priceMd: 2.82, priceConad: 3.05, notes: 'CONAD tradizionale' },
  { slug: 'riso_carnaroli', name: 'Riso Carnaroli', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 3.49, priceMd: 2.99, priceConad: null },
  { slug: 'riso_jasmin', name: 'Riso Jasmin', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 3.58, priceMd: null, priceConad: null },
  { slug: 'riso_venere', name: 'Riso Venere (nero)', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 3.58, priceMd: 5.98, priceConad: null, notes: "IN'S Nerone · MD Scotti" },
  { slug: 'riso_integrale', name: 'Riso Integrale', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: null, priceMd: 2.49, priceConad: null },
  { slug: 'orzo_perlato', name: 'Orzo perlato', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: 3.58, priceMd: 1.76, priceConad: 5.63 },
  { slug: 'saltimbocca', name: 'Saltimbocca', category: 'Pasta, Riso & Pane', unit: '1 kg', priceIns: null, priceMd: 4.98, priceConad: null },

  // Carne & Pesce
  { slug: 'pancetta', name: 'Pancetta dolce / affumicata', category: 'Carne & Pesce', unit: '1 kg', priceIns: 7.45, priceMd: 8.06, priceConad: 10.95 },
  { slug: 'salame', name: 'Salame', category: 'Carne & Pesce', unit: '1 kg', priceIns: 9.9, priceMd: 7.96, priceConad: 16.9, notes: 'MD: 7,96 €/kg sfilatino, 11,90 €/kg a fette' },
  { slug: 'bresaola', name: 'Bresaola', category: 'Carne & Pesce', unit: '1 kg', priceIns: null, priceMd: 36.12, priceConad: 42.11 },
  { slug: 'fesa_tacchino', name: 'Fesa di tacchino', category: 'Carne & Pesce', unit: '1 kg', priceIns: 13.5, priceMd: 14.08, priceConad: 17.9 },
  { slug: 'prosciutto_cotto', name: 'Prosciutto cotto', category: 'Carne & Pesce', unit: '1 kg', priceIns: 14.08, priceMd: 12.9, priceConad: 15.75 },
  { slug: 'speck', name: 'Speck', category: 'Carne & Pesce', unit: '1 kg', priceIns: null, priceMd: 15.9, priceConad: 21.0 },
  { slug: 'tonno', name: 'Tonno', category: 'Carne & Pesce', unit: '1 kg', priceIns: 10.75, priceMd: 12.33, priceConad: 15.13, notes: 'CONAD naturale 15,13 €/kg · leggero 18,71 €/kg' },
  { slug: 'salsicce_pollo', name: 'Salsicce di pollo', category: 'Carne & Pesce', unit: '1 kg', priceIns: null, priceMd: null, priceConad: null, inShoppingList: true, notes: 'Reparto carne' },
  { slug: 'salsicce_manzo', name: 'Salsicce di manzo', category: 'Carne & Pesce', unit: '1 kg', priceIns: null, priceMd: null, priceConad: null, inShoppingList: true, notes: 'Reparto carne' },
  { slug: 'macinato_pollo', name: 'Macinato di pollo', category: 'Carne & Pesce', unit: '1 kg', priceIns: null, priceMd: null, priceConad: null, inShoppingList: true, notes: 'Reparto carne' },
  { slug: 'macinato_manzo', name: 'Macinato di manzo', category: 'Carne & Pesce', unit: '1 kg', priceIns: null, priceMd: null, priceConad: null, inShoppingList: true, notes: 'Reparto carne' },

  // Condimenti & Dispensa
  { slug: 'amido_mais', name: 'Amido di mais', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: 3.16, priceConad: 3.56 },
  { slug: 'bicarbonato', name: 'Bicarbonato', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: 1.58, priceMd: null, priceConad: null },
  { slug: 'dado', name: 'Dado (classico / vegetale)', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 5.41 },
  { slug: 'farina_00', name: 'Farina 00', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: 0.49, priceMd: 0.49, priceConad: 0.65 },
  { slug: 'farina_integrale', name: 'Farina integrale', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: 0.79, priceMd: 0.85, priceConad: 0.99 },
  { slug: 'farina_avena', name: "Farina d'avena", category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: 3.58, priceMd: null, priceConad: 3.98 },
  { slug: 'insalatissime', name: 'Insalatissime', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 10.28, notes: 'Messicana' },
  { slug: 'ceci', name: 'Ceci', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: 2.04, priceConad: 2.79 },
  { slug: 'fagioli', name: 'Fagioli', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: 2.04, priceConad: 2.79 },
  { slug: 'lenticchie', name: 'Lenticchie', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: 2.04, priceConad: 3.0 },
  { slug: 'piselli', name: 'Piselli', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: 1.79, priceConad: 2.49 },
  { slug: 'misto_legumi_cereali', name: 'Misto legumi e cereali', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: 2.64, priceConad: 4.48 },
  { slug: 'semi_lino', name: 'Semi di lino', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: 6.95, priceMd: 5.96, priceConad: 8.6 },
  { slug: 'semi_chia', name: 'Semi di chia', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: 9.95, priceMd: 9.96, priceConad: 16.6 },
  { slug: 'olio_extravergine', name: 'Olio extravergine di oliva', category: 'Condimenti & Dispensa', unit: '1 L', priceIns: 4.99, priceMd: 5.12, priceConad: null },
  { slug: 'pan_grattato', name: 'Pan grattato', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: 1.7, priceMd: 1.98, priceConad: 1.98 },
  { slug: 'pomodoro_passata', name: 'Pomodoro Passata', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: 1.21, priceConad: 1.21 },
  { slug: 'pomodoro_pelati', name: 'Pomodoro Pelati', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: 2.29, priceConad: 2.29 },
  { slug: 'pomodoro_brik', name: 'Pomodoro in Brik', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 1.18, notes: 'CONAD: 1,18 €/kg medi · 1,65 €/kg piccoli' },
  { slug: 'sale', name: 'Sale (fino e grosso)', category: 'Condimenti & Dispensa', unit: '1 kg', priceIns: 0.27, priceMd: 0.29, priceConad: 0.39 },

  // Colazione & Dolci
  { slug: 'biscotti_misura', name: 'Biscotti Misura', category: 'Colazione & Dolci', unit: '1 kg', priceIns: null, priceMd: null, priceConad: 8.59 },
  { slug: 'biscotti_digestive', name: 'Biscotti Digestive', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 2.76, priceMd: 3.22, priceConad: 6.98 },
  { slug: 'biscotti_togo', name: 'Biscotti Togo', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 10.6, priceMd: null, priceConad: 13.52 },
  { slug: 'biscotti_gocciole', name: 'Biscotti Gocciole', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 2.84, priceMd: null, priceConad: 4.26 },
  { slug: 'biscotti_abbracci', name: 'Biscotti Abbracci', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 3.13, priceMd: null, priceConad: 4.26 },
  { slug: 'biscotti_oro_saiwa', name: 'Biscotti Oro Saiwa / Petit', category: 'Colazione & Dolci', unit: '1 pz', priceIns: 2.98, priceMd: 2.99, priceConad: null, notes: "IN'S: 2,98 € pacco 500g (petit) · MD: 2,99 € pacco 1kg" },
  { slug: 'burro_arachidi', name: 'Burro di arachidi', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 6.54, priceMd: 6.54, priceConad: 22.8 },
  { slug: 'cacao', name: 'Cacao', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 16.6, priceMd: 13.2, priceConad: 18.53, notes: 'CONAD senza zucch. 23,33 · MD senza zucch. 16,67' },
  { slug: 'caffe', name: 'Caffè', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 8.76, priceMd: 8.76, priceConad: 12.5 },
  { slug: 'cioccolato_fondente', name: 'Cioccolato fondente', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 11.73, priceMd: 9.98, priceConad: 13.8 },
  { slug: 'colla_pesce', name: 'Colla di pesce', category: 'Colazione & Dolci', unit: '1 kg', priceIns: null, priceMd: 95.83, priceConad: 82.5 },
  { slug: 'farina_cocco', name: 'Farina di cocco', category: 'Colazione & Dolci', unit: '1 kg', priceIns: null, priceMd: 7.96, priceConad: 7.96 },
  { slug: 'fette_biscottate', name: 'Fette biscottate', category: 'Colazione & Dolci', unit: '1 kg', priceIns: null, priceMd: 3.59, priceConad: null },
  { slug: 'granella_nocciole', name: 'Granella di nocciole', category: 'Colazione & Dolci', unit: '1 kg', priceIns: null, priceMd: 22.32, priceConad: 29.8 },
  { slug: 'lievito_paneangeli', name: 'Lievito Paneangeli', category: 'Colazione & Dolci', unit: '1 kg', priceIns: null, priceMd: 24.69, priceConad: 20.56, notes: 'CONAD: 20,56 €/kg piccolo, 26,87 grande · MD: grande' },
  { slug: 'nocciole_tostate', name: 'Nocciole tostate', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 17.45, priceMd: 18.6, priceConad: 22.82 },
  { slug: 'mandorle_tostate', name: 'Mandorle tostate', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 11.96, priceMd: null, priceConad: null },
  { slug: 'gocce_cioccolato', name: 'Gocce di cioccolato', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 15.96, priceMd: 14.95, priceConad: 14.95 },
  { slug: 'pinoli', name: 'Pinoli', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 45.9, priceMd: 87.25, priceConad: null },
  { slug: 'sciroppo_acero', name: "Sciroppo d'acero", category: 'Colazione & Dolci', unit: '1 L', priceIns: null, priceMd: 19.16, priceConad: 19.96 },
  { slug: 'vanillina', name: 'Vanillina', category: 'Colazione & Dolci', unit: '1 kg', priceIns: null, priceMd: 36.11, priceConad: 16.46 },
  { slug: 'zucchero', name: 'Zucchero', category: 'Colazione & Dolci', unit: '1 kg', priceIns: 0.95, priceMd: 0.99, priceConad: 0.99 },
  { slug: 'zucchero_velo', name: 'Zucchero a velo', category: 'Colazione & Dolci', unit: '1 kg', priceIns: null, priceMd: 4.4, priceConad: 4.72 },

  // Bevande & Acqua
  { slug: 'succo_limone', name: 'Succo di limone', category: 'Bevande & Acqua', unit: '1 L', priceIns: null, priceMd: 2.25, priceConad: 4.95 },
];

export const SEED_GROCERY_PRODUCTS: GroceryProduct[] = RAW_GROCERY_SEED.map((item) => ({
  id: `spesa_${item.slug}`,
  name: item.name,
  category: item.category,
  unit: item.unit,
  priceIns: item.priceIns,
  priceMd: item.priceMd,
  priceConad: item.priceConad,
  inShoppingList: Boolean(item.inShoppingList),
  notes: item.notes,
}));

export const SEED_GROCERY_ARTICLES: HomeArticleRecord[] = RAW_GROCERY_SEED.map((item) => ({
  id: `spesa_${item.slug}`,
  ...groceryProductToArticlePayload({
    name: item.name,
    category: item.category,
    unit: item.unit,
    priceIns: item.priceIns,
    priceMd: item.priceMd,
    priceConad: item.priceConad,
    inShoppingList: Boolean(item.inShoppingList),
    notes: item.notes,
  }),
}));
