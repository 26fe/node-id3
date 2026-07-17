const assert = require('assert')
const fs = require('fs')
const NodeID3 = require('../index.js')

function picture(id, description, mime = 'image/jpeg') {
    const typeNames = { 3: 'front cover', 4: 'back cover', 8: 'artist' }
    return {
        mime,
        type: { id, name: typeNames[id] },
        description,
        imageBuffer: Buffer.from(`${description}-bytes`)
    }
}

describe('NodeID3 multiple APIC core support', function() {
    const filepath = './multiple-apic-test.mp3'
    const pictures = [
        picture(NodeID3.TagConstants.AttachedPicture.PictureType.FRONT_COVER, 'front'),
        picture(NodeID3.TagConstants.AttachedPicture.PictureType.BACK_COVER, 'back', 'image/png'),
        picture(NodeID3.TagConstants.AttachedPicture.PictureType.ARTIST_OR_PERFORMER, 'artist')
    ]

    afterEach(function() {
        if(fs.existsSync(filepath)) {
            fs.unlinkSync(filepath)
        }
    })

    describe('reading', function() {
        it('omits images when no APIC frame exists', function() {
            const tags = NodeID3.read(NodeID3.create({ title: 'No artwork' }))

            assert.strictEqual(tags.image, undefined)
            assert.strictEqual(tags.images, undefined)
        })

        it('preserves singular behavior and exposes every APIC in order', function() {
            const buffer = NodeID3.create({ images: pictures })
            const tags = NodeID3.read(buffer)

            assert.deepStrictEqual(tags.images, pictures)
            assert.deepStrictEqual(tags.image, pictures[2])
            assert.deepStrictEqual(tags.raw.APIC, pictures[2])
            assert.deepStrictEqual(NodeID3.read(buffer, { onlyRaw: true }).APIC, pictures[2])
            assert.deepStrictEqual(NodeID3.read(buffer, { noRaw: true }).images, pictures)
        })

        it('collects ID3v2.4 APIC but leaves ID3v2.2 PIC unchanged', function() {
            const v4 = NodeID3.create({ images: pictures })
            v4[3] = 4
            assert.deepStrictEqual(NodeID3.read(v4).images, pictures)

            const v2 = Buffer.from('4944330200000000001050494300000a004a5047030061626364', 'hex')
            assert.strictEqual(NodeID3.read(v2).image.mime, 'JPG')
            assert.strictEqual(NodeID3.read(v2).images, undefined)
        })
    })

    describe('creating and writing', function() {
        it('writes one APIC per collection entry in order', function() {
            assert.deepStrictEqual(NodeID3.read(NodeID3.create({ images: pictures })).images, pictures)
        })

        it('accepts every standard picture type id', function() {
            const allTypes = Array.from({ length: 21 }, (_, id) => picture(id, `type-${id}`))
            const ids = NodeID3.read(NodeID3.create({ images: allTypes })).images.map((image) => image.type.id)

            assert.deepStrictEqual(ids, allTypes.map((image) => image.type.id))
        })

        it('writes collections to buffers and disposable files', function(done) {
            const buffer = NodeID3.write({ images: pictures }, Buffer.from([1, 2, 3]))
            assert.deepStrictEqual(NodeID3.read(buffer).images, pictures)

            fs.writeFileSync(filepath, Buffer.from([1, 2, 3]))
            NodeID3.write({ images: pictures }, filepath, function(error) {
                if(error) {
                    done(error)
                    return
                }
                assert.deepStrictEqual(NodeID3.read(filepath).images, pictures)
                done()
            })
        })

        it('supports add and remove through a full supported-tag rewrite', function() {
            const original = NodeID3.create({ title: 'Title', images: pictures.slice(0, 2) })
            const current = NodeID3.read(original)
            const images = [...current.images, pictures[2]]
            delete current.image
            delete current.images
            delete current.raw

            const added = NodeID3.write(Object.assign({}, current, { images }), original)
            assert.deepStrictEqual(NodeID3.read(added).images, pictures)
            assert.strictEqual(NodeID3.read(added).title, 'Title')

            images.splice(1, 1)
            const removed = NodeID3.write(Object.assign({}, current, { images }), added)
            assert.deepStrictEqual(NodeID3.read(removed).images, [pictures[0], pictures[2]])
        })

        it('writes no APIC for an empty collection', function() {
            const tags = NodeID3.read(NodeID3.create({ title: 'Title', images: [] }))

            assert.strictEqual(tags.images, undefined)
            assert.strictEqual(tags.image, undefined)
            assert.strictEqual(tags.title, 'Title')
        })
    })

    describe('validation', function() {
        const invalidTags = [
            { images: 'not-an-array' },
            { images: [Buffer.alloc(1)] },
            { images: [{ mime: 'image/png', description: 'missing buffer', type: { id: 3 } }] },
            { images: [{ mime: 'image/png', description: 'bad type', type: { id: 21 }, imageBuffer: Buffer.alloc(1) }] },
            { image: pictures[0], images: pictures }
        ]

        it('throws before creating or synchronously writing invalid collections', function() {
            invalidTags.forEach((tags) => {
                assert.throws(() => NodeID3.create(tags), TypeError)
                assert.throws(() => NodeID3.create(tags, function() {}), TypeError)
                assert.throws(() => NodeID3.write(tags, Buffer.alloc(0)), TypeError)
            })
        })

        it('reports callback errors without modifying the file', function(done) {
            const original = NodeID3.create({ title: 'Original' })
            fs.writeFileSync(filepath, original)

            NodeID3.write(invalidTags[0], filepath, function(error) {
                assert(error instanceof TypeError)
                assert.deepStrictEqual(fs.readFileSync(filepath), original)
                done()
            })
        })

        it('rejects create and write promises', function() {
            return Promise.all([
                assert.rejects(NodeID3.Promise.create(invalidTags[2]), TypeError),
                assert.rejects(NodeID3.Promise.write(invalidTags[3], Buffer.alloc(0)), TypeError)
            ])
        })
    })
})
