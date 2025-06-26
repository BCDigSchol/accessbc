# Uploading Tileset in Mapbox
#### [Made by Lester Carver with Scribe](https://scribehow.com/shared/Uploading_Tileset_in_Mapbox__ZDJ90BnAR6-IDdgJ2p3RLA)


1\. Navigate to [mapbox.com](https://console.mapbox.com/)

![](https://ajeuwbhvhr.cloudimg.io/https://colony-recorder.s3.amazonaws.com/files/2025-06-26/00469e88-128b-4679-9240-1daaf8d947d2/ascreenshot.jpeg?tl_px=82,70&br_px=1458,840&force_format=jpeg&q=100&width=1120.0)


2\. Click "Data manager"

![](https://ajeuwbhvhr.cloudimg.io/https://colony-recorder.s3.amazonaws.com/files/2025-06-26/00469e88-128b-4679-9240-1daaf8d947d2/ascreenshot.jpeg?tl_px=0,0&br_px=1376,769&force_format=jpeg&q=100&width=1120.0&wat=1&wat_opacity=1&wat_gravity=northwest&wat_url=https://colony-recorder.s3.amazonaws.com/images/watermarks/FB923C_standard.png&wat_pad=70,113)


3\. Click "New tileset"

![](https://ajeuwbhvhr.cloudimg.io/https://colony-recorder.s3.amazonaws.com/files/2025-06-26/b869e3f9-83f9-4c8b-8a91-62d13aadb446/ascreenshot.jpeg?tl_px=164,0&br_px=1541,769&force_format=jpeg&q=100&width=1120.0&wat=1&wat_opacity=1&wat_gravity=northwest&wat_url=https://colony-recorder.s3.amazonaws.com/images/watermarks/FB923C_standard.png&wat_pad=751,5)


4\. Select the data file to upload

![](https://ajeuwbhvhr.cloudimg.io/https://colony-recorder.s3.amazonaws.com/files/2025-06-26/9300c5ba-af7d-4d70-8021-2eca8343ecfc/ascreenshot.jpeg?tl_px=89,0&br_px=1465,769&force_format=jpeg&q=100&width=1120.0&wat=1&wat_opacity=1&wat_gravity=northwest&wat_url=https://colony-recorder.s3.amazonaws.com/images/watermarks/FB923C_standard.png&wat_pad=524,254)


5\. Once uploaded, note the layer name.

![](https://ajeuwbhvhr.cloudimg.io/https://colony-recorder.s3.amazonaws.com/files/2025-06-26/da221a17-c7a0-46f3-8f5f-26f16887f1f3/user_cropped_screenshot.webp?tl_px=250,42&br_px=1110,523&force_format=jpeg&q=100&width=860)


6\. Click "options" next to the layer name

![](https://ajeuwbhvhr.cloudimg.io/https://colony-recorder.s3.amazonaws.com/files/2025-06-26/a1743b66-1879-468d-8cc8-4503487c031b/ascreenshot.jpeg?tl_px=324,34&br_px=1184,515&force_format=jpeg&q=100&width=860&wat_scale=76&wat=1&wat_opacity=1&wat_gravity=northwest&wat_url=https://colony-recorder.s3.amazonaws.com/images/watermarks/FB923C_standard.png&wat_pad=784,176)


7\. Note the Tileset ID

![](https://ajeuwbhvhr.cloudimg.io/https://colony-recorder.s3.amazonaws.com/files/2025-06-26/01cf4fd8-573e-418c-af27-c43926365e6a/user_cropped_screenshot.webp?tl_px=776,136&br_px=1541,563&force_format=jpeg&q=100&width=764)


8\. In the datasources.js file, under the [[addSource() ]]functions, change the layer name to the tileset name and the url to [[mapbox:// + tileset ID]]

![](https://ajeuwbhvhr.cloudimg.io/https://colony-recorder.s3.amazonaws.com/files/2025-06-26/0f30dfa2-8863-4ef0-8a5a-f55e8f9ab4b9/user_cropped_screenshot.webp?tl_px=15,165&br_px=640,515&force_format=jpeg&q=100&width=625)


9\. In the [[addLayer()]] functions, change the [[source]] and [[source-layer]] properties to the tileset name.

![](https://ajeuwbhvhr.cloudimg.io/https://colony-recorder.s3.amazonaws.com/files/2025-06-26/c740222b-1ac0-4711-8f41-c67739aca5e4/user_cropped_screenshot.webp?tl_px=0,271&br_px=764,699&force_format=jpeg&q=100&width=764)
#### [Made with Scribe](https://scribehow.com/shared/Uploading_Tileset_in_Mapbox__ZDJ90BnAR6-IDdgJ2p3RLA)