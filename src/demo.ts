import type { WebRecipe } from './store'

// Exempelrecept för att testa swipen utan server. Riktiga recept från ICA och Köket.se, men bara namn och länk.
// Era swipes på dem sparas bara på den här telefonen.
const list: [source: string, slug: string, title: string, category: WebRecipe['category']][] = [
  ['Köket.se', 'pasta-med-bacon-och-vasterbottensost', 'Pasta med bacon och västerbottensost', 'fast'],
  ['ICA', 'grillad-tandoorikyckling-med-gurksallad-5', 'Grillad tandoorikyckling med gurksallad', 'fast'],
  ['Köket.se', 'kramig-flaskfilegryta-med-dragon-och-parmesan', 'Krämig fläskfilégryta med dragon och parmesan', 'storkok'],
  ['Köket.se', 'krabbtoast-med-smorad-krabbsas', 'Krabbtoast med smörad krabbsås', 'finmiddag'],
  ['ICA', 'gul-habanerosoppa-med-vitlokskrutonger-3', 'Gul habanerosoppa med vitlökskrutonger', 'storkok'],
  ['Köket.se', 'biff-minute-med-ljummen-sallad', 'Biff minute med ljummen sallad', 'fast'],
  ['Köket.se', 'shepherds-pie-med-hjort', 'Shepherd’s pie med hjort', 'storkok'],
  ['ICA', 'glad-kyckling-15', 'Glad kyckling', 'fast'],
  ['Köket.se', 'braserad-oxbringa-med-parmesanpure', 'Braserad oxbringa med parmesanpuré', 'finmiddag'],
  ['Köket.se', 'asiatiskt-farsfras-med-krispiga-gronsaker-och-chili', 'Asiatiskt färsfräs med krispiga grönsaker och chili', 'fast'],
  ['ICA', 'ljummen-farskpotatissallad-med-basilikacreme-8', 'Ljummen färskpotatissallad med basilikacrème', 'fast'],
  ['Köket.se', 'pasta-bolognese-med-kikartor-och-aubergine', 'Pasta bolognese med kikärtor och aubergine', 'storkok'],
  ['Köket.se', 'stekt-fisk-med-ljummen-linssallad', 'Stekt fisk med ljummen linssallad', 'fast'],
  ['ICA', 'blomkalstimbal-med-radissallad-9', 'Blomkålstimbal med rädissallad', 'finmiddag'],
  ['Köket.se', 'tareq-taylors-ovantade-carbonara', 'Tareq Taylors oväntade carbonara', 'fast'],
  ['Köket.se', 'smordegstarte-med-ostkram-och-smorstekt-svamp', 'Smördegstarte med ostkräm och smörstekt svamp', 'finmiddag'],
]

const url = (source: string, slug: string) =>
  source === 'ICA' ? `https://www.ica.se/recept/${slug}/` : `https://www.koket.se/${slug}`

export const demoRecipes: WebRecipe[] = list.map(([source, slug, title, category], i) => ({
  id: `demo-${i + 1}`,
  source,
  url: url(source, slug),
  title,
  category,
  rank: i,
}))
