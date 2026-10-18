import type { WebRecipe } from './store'

// Exempelrecept för att testa swipen utan server. Riktiga recept från ICA och Köket.se: namn, bild och länk.
// Era swipes på dem sparas bara på den här telefonen.
const list: [source: string, slug: string, title: string, category: WebRecipe['category'], image: string][] = [
  [
    'Köket.se',
    'pasta-med-bacon-och-vasterbottensost',
    'Pasta med bacon och västerbottensost',
    'fast',
    'https://img.koket.se/standard-mega/pasta-med-bacon-och-vasterbottensost.png.jpg',
  ],
  [
    'ICA',
    'grillad-tandoorikyckling-med-gurksallad-5',
    'Grillad tandoorikyckling med gurksallad',
    'fast',
    'https://assets.icanet.se/e_sharpen:80,q_auto,dpr_1.25,w_718,h_718,c_lfill/imagevaultfiles/id_15418/cf_259/grillad_tandoorikyckling_med_gurksallad.jpg',
  ],
  [
    'Köket.se',
    'kramig-flaskfilegryta-med-dragon-och-parmesan',
    'Krämig fläskfilégryta med dragon och parmesan',
    'storkok',
    'https://img.koket.se/standard-mega/kramig-flaskfilegryta-med-dragon-och-parmesan.png.jpg',
  ],
  [
    'ICA',
    'ostlasagne-728716',
    'Ostlasagne',
    'storkok',
    'https://assets.icanet.se/e_sharpen:80,q_auto,dpr_1.25,w_718,h_718,c_lfill/imagevaultfiles/id_237967/cf_259/ostlasagne.jpg',
  ],
  [
    'Köket.se',
    'krabbtoast-med-smorad-krabbsas',
    'Krabbtoast med smörad krabbsås',
    'finmiddag',
    'https://img.koket.se/standard-mega/krabbtoast-med-smorad-krabbsas.png.jpg',
  ],
  [
    'ICA',
    'flaskfars-i-paneng-curry-med-nudlar-728717',
    'Fläskfärs i paneng curry med nudlar',
    'fast',
    'https://assets.icanet.se/e_sharpen:80,q_auto,dpr_1.25,w_718,h_718,c_lfill/imagevaultfiles/id_238247/cf_259/flaskfars_i_paneng_curry_med_nudlar.jpg',
  ],
  [
    'Köket.se',
    'biff-minute-med-ljummen-sallad',
    'Biff minute med ljummen sallad',
    'fast',
    'https://img.koket.se/standard-mega/biff-minute-med-ljummen-sallad-pa-betor.png.jpg',
  ],
  [
    'ICA',
    'italiensk-gryta-med-chorizo-och-oliver-728701',
    'Italiensk gryta med chorizo och oliver',
    'storkok',
    'https://assets.icanet.se/e_sharpen:80,q_auto,dpr_1.25,w_718,h_718,c_lfill/imagevaultfiles/id_234972/cf_259/italiensk_gryta_med_chorizo_og_oliver.jpg',
  ],
  [
    'Köket.se',
    'shepherds-pie-med-hjort',
    'Shepherd’s pie med hjort',
    'storkok',
    'https://img.koket.se/standard-mega/shepherds-pie-med-hjort.png.jpg',
  ],
  [
    'ICA',
    'dillbakad-torsk-med-rostad-morotskram-728720',
    'Dillbakad torsk med rostad morotskräm',
    'fast',
    'https://assets.icanet.se/e_sharpen:80,q_auto,dpr_1.25,w_718,h_718,c_lfill/imagevaultfiles/id_237384/cf_259/dillbakad_torsk_med_rostad_morotskram.jpg',
  ],
  [
    'Köket.se',
    'braserad-oxbringa-med-parmesanpure',
    'Braserad oxbringa med parmesanpuré',
    'finmiddag',
    'https://img.koket.se/standard-mega/braserad-oxbringa-med-parmesanpure.png.jpg',
  ],
  [
    'ICA',
    'kramig-pasta-med-bacon-och-champinjoner-728700',
    'Krämig pasta med bacon och champinjoner',
    'fast',
    'https://assets.icanet.se/e_sharpen:80,q_auto,dpr_1.25,w_718,h_718,c_lfill/imagevaultfiles/id_234968/cf_259/kramig_pasta_med_bacon_och_champinjoner.jpg',
  ],
  [
    'Köket.se',
    'pasta-bolognese-med-kikartor-och-aubergine',
    'Pasta bolognese med kikärtor och aubergine',
    'storkok',
    'https://img.koket.se/standard-mega/pasta-bolognese-med-kikartor-och-aubergine.png.jpg',
  ],
  [
    'ICA',
    'kyckling-med-blomkal-i-tikka-masala-728698',
    'Kyckling med blomkål i tikka masala',
    'fast',
    'https://assets.icanet.se/e_sharpen:80,q_auto,dpr_1.25,w_718,h_718,c_lfill/imagevaultfiles/id_234898/cf_259/kyckling_med_blomkal_i_tikka_masala.jpg',
  ],
  [
    'Köket.se',
    'stekt-fisk-med-ljummen-linssallad',
    'Stekt fisk med ljummen linssallad',
    'fast',
    'https://img.koket.se/standard-mega/stekt-fisk-med-ljummen-linssallad.png.jpg',
  ],
  [
    'Köket.se',
    'smordegstarte-med-ostkram-och-smorstekt-svamp',
    'Smördegstarte med ostkräm och smörstekt svamp',
    'finmiddag',
    'https://img.koket.se/standard-mega/smordegstarte-med-ostkram-och-smorstekt-svamp.png.jpg',
  ],
]

const url = (source: string, slug: string) =>
  source === 'ICA' ? `https://www.ica.se/recept/${slug}/` : `https://www.koket.se/${slug}`

export const demoRecipes: WebRecipe[] = list.map(([source, slug, title, category, image], i) => ({
  id: `demo-${i + 1}`,
  source,
  url: url(source, slug),
  title,
  category,
  image,
  rank: i,
}))
