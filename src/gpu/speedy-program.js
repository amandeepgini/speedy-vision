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
 * speedy-program.js
 * SpeedyProgram class
 */

import { ShaderPreprocessor } from './shader-preprocessor.js';

const LOCATION_ATTRIB_POSITION = 0;
const LOCATION_ATTRIB_TEXCOORD = 1;

const DEFAULT_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 texCoord;
 
void main() {
    gl_Position = vec4(a_position, 0, 1);
    texCoord = a_texCoord;
}`;

const DEFAULT_FRAGMENT_SHADER_PREFIX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
 
out vec4 color;
in vec2 texCoord;
uniform ivec2 texSize;\n`;

const UNIFORM_TYPES = {
    'sampler2D':'uniform1i',
    'float':    'uniform1f',
    'int':      'uniform1i',
    'uint':     'uniform1ui',
    'bool':     'uniform1i',
    'vec2':     'uniform2f',
    'vec3':     'uniform3f',
    'vec4':     'uniform4f',
    'ivec2':    'uniform2i',
    'ivec3':    'uniform3i',
    'ivec4':    'uniform4i',
    'uvec2':    'uniform2ui',
    'uvec3':    'uniform3ui',
    'uvec4':    'uniform4ui',
    'bvec2':    'uniform2i',
    'bvec3':    'uniform3i',
    'bvec4':    'uniform4i',
};

/**
 * A SpeedyProgram is a Function that
 * runs GPU-accelerated GLSL code
 */
class SpeedyProgram extends Function
{
    /**
     * Creates a new SpeedyProgram
     * @param {WebGL2RenderingContext} gl WebGL context
     * @param {Function} shaderdecl shader declaration
     * @param {object} [options] user options
     */
    constructor(gl, shaderdecl, options = { })
    {
        super('...args', 'return this._self._call(...args)');
        this._self = this.bind(this);
        this._self._init(gl, shaderdecl, options);
        return this._self;
    }

    /**
     * Resize the output texture
     * @param {number} width 
     * @param {number} height 
     */
    resize(width, height)
    {
        const gl = this._gl;
        const options = this._options;

        // no need to resize?
        if(width === this._stdprog.width && height === this._stdprog.height)
            return;

        // get size
        width = Math.max(1, width | 0);
        height = Math.max(1, height | 0);
        options.output = [ width, height ];

        // resize stdprog
        if(options.renderToTexture)
            this._stdprog = detachFBO(this._stdprog);

        this._stdprog.width = width;
        this._stdprog.height = height;

        if(options.renderToTexture)
            this._stdprog = attachFBO(this._stdprog);

        // update texSize uniform
        const uniform = this._stdprog.uniform.texSize;
        (gl[UNIFORM_TYPES[uniform.type]])(uniform.location, width, height);
        console.log(`Resized program to ${width} x ${height}`);

        // invalidate pixel buffers
        this._pixels = null;
    }

    /**
     * Read pixels from the output texture.
     * You may optionally specify a (x,y,width,height) sub-rectangle.
     * @param {number} [x]
     * @param {number} [y] 
     * @param {number} [width]
     * @param {number} [height]
     * @returns {Uint8Array} pixels in the RGBA format
     */
    readPixelsSync(x = 0, y = 0, width = -1, height = -1)
    {
        const gl = this._gl;
        const pixels = this._pixels || (this._pixels = new Uint8Array(this._stdprog.width * this._stdprog.height * 4));
        //const flippedPixels = this._flippedPixels || (this._flippedPixels = new Uint8Array(pixels.length));

        // default values
        if(width < 0)
            width = this._stdprog.width;
        if(height < 0)
            height = this._stdprog.height;

        // clamp values
        width = Math.min(width, this._stdprog.width);
        height = Math.min(height, this._stdprog.height);
        x = Math.max(0, Math.min(x, width - 1));
        y = Math.max(0, Math.min(y, height - 1));

        // read pixels
        if(this._stdprog.fbo) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._stdprog.fbo);
            gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        else
            gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        // flip y-axis
        /*
        let a, b;
        for(let i = 0; i < height; i++) {
            for(let j = 0; j < width; j++) {
                a = 4 * (i * width + j);
                b = 4 * ((height - 1 - i) * width + j);
                pixels[a + 0] = flippedPixels[b + 0];
                pixels[a + 1] = flippedPixels[b + 1];
                pixels[a + 2] = flippedPixels[b + 2];
                pixels[a + 3] = flippedPixels[b + 3];
            }
        }
        return this._flippedPixels;
        */

        // return cached array
        return this._pixels;
    }

    // Prepare the shader
    _init(gl, shaderdecl, options)
    {
        // default options
        options = {
            output: [ gl.drawingBufferWidth, gl.drawingBufferHeight ], // size of the output texture
            uniforms: { }, // user-defined constants (as uniforms)
            renderToTexture: true, // render results to a texture?
            recycleTexture: true, // recycle output texture? If false, you must manually destroy the output texture
            ...options // user-defined options
        };

        // get size
        let [width, height] = options.output;
        width = Math.max(1, width | 0);
        height = Math.max(1, height | 0);
        options.output = [ width, height ];

        // create shader
        const source = shaderdecl();
        /*const stdprog = options.renderToTexture ?
            createStandardProgramWithFBO(gl, width, height, source, options.uniforms) :
            createStandardProgram(gl, width, height, source, options.uniforms);*/
        let stdprog = createStandardProgram(gl, width, height, source, options.uniforms);

        if(options.renderToTexture)
            stdprog = attachFBO(stdprog);

        // validate arguments
        const uniforms = functionArguments(shaderdecl);
        for(let j = 0; j < uniforms.length; j++) {
            if(!stdprog.uniform.hasOwnProperty(uniforms[j]))
                throw GLUtils.Error(`Can't run shader: expected uniform "${uniforms[j]}"`);
        }

        // store context
        this._gl = gl;
        this._source = source;
        this._options = options;
        this._stdprog = stdprog;
        this._uniforms = uniforms;
        this._pixels = null;
    }

    // Run the SpeedyProgram
    _call(...args)
    {
        const gl = this._gl;
        const options = this._options;
        const stdprog = this._stdprog;
        const uniforms = this._uniforms;
        
        // matching arguments?
        if(args.length != uniforms.length)
            throw GLUtils.Error(`Can't run shader: incorrect number of arguments`);

        // use program
        gl.useProgram(stdprog.program);

        // set uniforms[i] to args[i]
        for(let i = 0, texNo = 0; i < args.length; i++) {
            const argname = uniforms[i];
            const uniform = stdprog.uniform[argname];

            if(uniform.type == 'sampler2D') {
                // set texture
                if(texNo > gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS)
                    throw GLUtils.Error(`Can't bind ${texNo} textures to a program: max is ${gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS}`);
                else if(args[i] === stdprog.texture)
                    throw GLUtils.Error(`Can't run shader: cannot use its output texture as an input to itself`);

                gl.activeTexture(gl.TEXTURE0 + texNo);
                gl.bindTexture(gl.TEXTURE_2D, args[i]);
                gl.uniform1i(uniform.location, texNo);
                texNo++;
            }
            else {
                // set value
                if(typeof args[i] == 'number' || typeof args[i] == 'boolean')
                    (gl[UNIFORM_TYPES[uniform.type]])(uniform.location, args[i]);
                else if(Array.isArray(args[i]))k
                    (gl[UNIFORM_TYPES[uniform.type]])(uniform.location, ...(args[i]));
                else
                    throw GLUtils.Error(`Can't run shader: unrecognized argument "${args[i]}"`);
            }
        }

        // render
        if(options.renderToTexture)
            gl.bindFramebuffer(gl.FRAMEBUFFER, stdprog.fbo);
        else
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        gl.viewport(0, 0, stdprog.width, stdprog.height);
        gl.drawArrays(gl.TRIANGLE_STRIP,
                      0,        // offset
                      4);       // count       

        // output texture
        let outputTexture = null;
        if(options.renderToTexture) {
            outputTexture = stdprog.texture;
            if(!options.recycleTexture) {
                // clone outputTexture using the current framebuffer
                const cloneTexture = GLUtils.createTexture(gl, stdprog.width, stdprog.height);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, cloneTexture);
                gl.copyTexSubImage2D(gl.TEXTURE_2D,     // target
                                     0,                 // mipmap level
                                     0,                 // xoffset
                                     0,                 // yoffset
                                     0,                 // x
                                     0,                 // y
                                     stdprog.width,     // width
                                     stdprog.height);   // height
                gl.bindTexture(gl.TEXTURE_2D, null);
                outputTexture = cloneTexture;
            }
        }

        // return texture (if available)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return outputTexture;
    }
}

// a dictionary specifying the types of all uniforms in the code
function autodetectUniforms(shaderSource)
{
    //const sourceWithoutMultilineComments = shaderSource.replace(/\/\*(.|\s)*?\*\//g, ''); // strip /* */ comments
    //const sourceWithoutComments = sourceWithoutMultilineComments.replace(/\/\/.*$/gm, ''); // strip // comments
    const sourceWithoutComments = shaderSource; // assume we've preprocessed the source already
    const regex = /uniform\s+(\w+)\s+([^;]+)/g;
    const uniforms = { };

    let match;
    while((match = regex.exec(sourceWithoutComments)) !== null) {
        const type = match[1];
        const names = match[2].split(',').map(name => name.trim()).filter(name => name); // trim & remove empty names
        for(const name of names)
            uniforms[name] = { type };
    }

    return uniforms;
}

// names of function arguments
function functionArguments(fun)
{
    const code = fun.toString();
    const regex = code.startsWith('function') ? 'function\\s.*\\(([^)]*)\\)' :
                 (code.startsWith('(') ? '\\(([^)]*)\\).*=>' : '([^=]+).*=>');
    const match = new RegExp(regex).exec(code);

    if(match !== null) {
        const args = match[1].replace(/\/\*.*?\*\//g, ''); // remove comments
        return args.split(',').map(argname =>
            argname.replace(/=.*$/, '').trim() // remove default params & trim
        ).filter(argname =>
            argname // handle trailing commas
        );
    }
    else {
        throw GLUtils.Error(`Can't detect function arguments of ${code}`);
        //return [];
    }
}

// create VAO & VBO
function createStandardGeometry(gl)
{
    // cached values?
    const f = createStandardGeometry;
    const cache = f._cache || (f._cache = new WeakMap());
    if(cache.has(gl))
        return cache.get(gl);

    // configure the attributes of the vertex shader
    const vao = gl.createVertexArray(); // vertex array object
    const vbo = [ gl.createBuffer(), gl.createBuffer() ]; // vertex buffer objects
    gl.bindVertexArray(vao);

    // set the a_position attribute
    // using the current vbo
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo[0]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        // clip coordinates
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
    ]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(LOCATION_ATTRIB_POSITION, // attribute location
                           2,          // 2 components per vertex (x,y)
                           gl.FLOAT,   // type
                           false,      // don't normalize
                           0,          // default stride (tightly packed)
                           0);         // offset
    gl.enableVertexAttribArray(LOCATION_ATTRIB_POSITION);

    // set the a_texCoord attribute
    // using the current vbo
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo[1]);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        // texture coordinates
        0, 0,
        1, 0,
        0, 1,
        1, 1,
    ]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(LOCATION_ATTRIB_TEXCOORD, // attribute location
                           2,          // 2 components per vertex (x,y)
                           gl.FLOAT,   // type
                           false,      // don't normalize
                           0,          // default stride (tightly packed)
                           0);         // offset
    gl.enableVertexAttribArray(LOCATION_ATTRIB_TEXCOORD);

    // unbind & return
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const result = { vao, vbo };
    cache.set(gl, result);
    return result;
}

// a standard program runs a shader on an "image"
// uniforms: { 'name': <default_value>, ... }
function createStandardProgram(gl, width, height, fragmentShaderSource, uniforms = { })
{
    // compile shaders
    const source = ShaderPreprocessor.run(DEFAULT_FRAGMENT_SHADER_PREFIX + fragmentShaderSource);
    const program = GLUtils.createProgram(gl, DEFAULT_VERTEX_SHADER, source);

    // setup geometry
    gl.bindAttribLocation(program, LOCATION_ATTRIB_POSITION, 'a_position');
    gl.bindAttribLocation(program, LOCATION_ATTRIB_TEXCOORD, 'a_texCoord');
    const vertexObjects = createStandardGeometry(gl);

    // define texSize
    width = Math.max(width | 0, 1);
    height = Math.max(height | 0, 1);
    uniforms.texSize = [ width, height ];

    // autodetect uniforms, get their locations,
    // define their setters and set their default values
    const uniform = autodetectUniforms(source);
    gl.useProgram(program);
    for(const u in uniform) {
        // get location
        uniform[u].location = gl.getUniformLocation(program, u);

        // validate type
        if(!UNIFORM_TYPES.hasOwnProperty(uniform[u].type))
            throw GLUtils.Error(`Unknown uniform type: ${uniform[u].type}`);

        // must set a default alue?
        if(uniforms.hasOwnProperty(u)) {
            const value = uniforms[u];
            if(typeof value == 'number' || typeof value == 'boolean')
                (gl[UNIFORM_TYPES[uniform[u].type]])(uniform[u].location, value);
            else if(typeof value == 'object')
                (gl[UNIFORM_TYPES[uniform[u].type]])(uniform[u].location, ...Array.from(value));
            else
                throw GLUtils.Error(`Unrecognized uniform value: "${value}"`);
        }
    }

    // done!
    return {
        program,
        gl,
        uniform,
        width,
        height,
        ...vertexObjects,
    };
}

// TODO: attaach FBO, detach FBO for tex resize
function createStandardProgramWithFBO(gl, width, height, fragmentShaderSource, uniforms = { })
{
    width = Math.max(width | 0, 1);
    height = Math.max(height | 0, 1);

    const texture = GLUtils.createTexture(gl, width, height);
    const fbo = GLUtils.createFramebuffer(gl, texture);
    const stdprog = createStandardProgram(gl, width, height, fragmentShaderSource, uniforms);

    return {
        ...stdprog,
        texture,
        fbo,
    };
}

// Attach a framebuffer object to a standard program
function attachFBO(stdprog)
{
    const gl = stdprog.gl;
    const width = stdprog.width;
    const height = stdprog.height;

    const texture = GLUtils.createTexture(gl, width, height);
    const fbo = GLUtils.createFramebuffer(gl, texture);

    return {
        ...stdprog,
        texture,
        fbo,
    };
}

// Detach a framebuffer object from a standard program
function detachFBO(stdprog)
{
    if(stdprog.hasOwnProperty('fbo')) {
        GLUtils.destroyFramebuffer(stdprog.fbo);
        delete stdprog.fbo;
    }

    if(stdprog.hasOwnProperty('texture')) {
        GLUtils.destroyTexture(stdprog.texture);
        delete stdprog.texture;
    }

    return stdprog;
}