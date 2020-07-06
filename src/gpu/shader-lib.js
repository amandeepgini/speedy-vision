/*
 * speedy-vision.js
 * GPU-accelerated Computer Vision for the web
 * Copyright 2020 Alexandre Martins <alemartf(at)gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * shader-lib.js
 * Common shader routines
 */

import { GLUtils } from './gl-utils';

const SHADER_LIB = {

//
// Global utilities
// (available in all shaders)
//
'global.glsl': gl =>
`
// Integer position of the current texel
#define threadLocation() ivec2(texCoord * texSize)

// Output size
#define outputSize() ivec2(texSize)

// Get current pixel (independent texture lookup)
#define currentPixel(img) texture((img), texCoord)

// Get pixel at (x,y)
#define pixelAt(img, pos) texelFetch((img), (pos), 0)

// Get the pixel at a constant (dx,dy) offset\n` +
(
    gl.MAX_PROGRAM_TEXEL_OFFSET >= 7 ?
    `#define pixelAtOffset(img, offset) textureOffset((img), texCoord, (offset))\n` :
    `#define pixelAtOffset(img, offset) texture((img), texCoord + vec2(offset) / texSize)\n`
) +
`
`,

};

/**
 * ShaderLib class
 */
export class ShaderLib
{
     /**
     * Reads a shader from the virtual filesystem
     * @param {WebGL2RenderingContext} gl
     * @param {string} filename 
     * @returns {string}
     */
    static readfileSync(gl, filename)
    {
        if(SHADER_LIB.hasOwnProperty(filename))
            return (SHADER_LIB[filename])(gl);

        throw GLUtils.Error(`Can't find file \"${filename}\"`);
    }
}