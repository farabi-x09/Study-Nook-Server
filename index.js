const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
dotenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const port = process.env.PORT;

app.use(cors({
  // http://localhost:3000
  // chenge this
  origin: [`${process.env.CLIENT_URL}`],
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Auth Middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  jwt.verify(token, process.env.JWT_SECRET || "secret", (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    // The assignment asks for { id: userId }, we attach whatever was encoded
    req.user = decoded;
    next();
  });
};

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // comment this for deploy
    // await client.connect();

    const db = client.db("studynook");
    const roomCollection = db.collection("rooms");
    const bookingCollection = db.collection("bookings");

    // Auth APIs
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.JWT_SECRET || "secret", { expiresIn: "365d" });
      res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      }).send({ success: true });
    });

    app.post("/logout", async (req, res) => {
      res.clearCookie("token", {
        maxAge: 0,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      }).send({ success: true });
    });

    app.get('/room', async (req, res) => {
      const { search, amenities, minRate, maxRate, sort, limit, email } = req.query;

      // Build filter query
      const query = {};

      // Filter by owner email (for My Listings page)
      if (email) {
        query.userEmail = email;
      }

      // Search by name (case-insensitive partial match)
      if (search && search.trim()) {
        query.name = { $regex: search.trim(), $options: 'i' };
      }

      // Filter by amenities — room must have ALL selected amenities
      if (amenities) {
        const amenityList = Array.isArray(amenities) ? amenities : amenities.split(',').filter(Boolean);
        if (amenityList.length > 0) {
          query.amenities = { $all: amenityList };
        }
      }

      // Filter by hourly rate range
      if (minRate || maxRate) {
        query.hourlyRate = {};
        if (minRate) query.hourlyRate.$gte = parseFloat(minRate);
        if (maxRate) query.hourlyRate.$lte = parseFloat(maxRate);
      }

      // Sorting
      const limitNum = limit ? parseInt(limit) : 0;

      let result;

      if (sort === 'most-booked') {
        // Pipeline-based $lookup: convert room _id to string so it matches
        // the string roomId stored in booking documents
        const pipeline = [
          { $match: query },
          {
            $lookup: {
              from: 'bookings',
              let: { roomIdStr: { $toString: '$_id' } },
              pipeline: [
                { $match: { $expr: { $eq: ['$roomId', '$$roomIdStr'] } } },
              ],
              as: 'bookingDocs',
            },
          },
          { $addFields: { bookingCount: { $size: '$bookingDocs' } } },
          { $sort: { bookingCount: -1, _id: -1 } },
          { $project: { bookingDocs: 0, bookingCount: 0 } },
          ...(limitNum > 0 ? [{ $limit: limitNum }] : []),
        ];
        result = await roomCollection.aggregate(pipeline).toArray();
      } else if (sort === 'price-low' || sort === 'price-high') {
        // Use $toDouble so legacy rooms with hourlyRate stored as a string
        // still sort numerically instead of lexicographically
        const sortDir = sort === 'price-low' ? 1 : -1;
        const pipeline = [
          { $match: query },
          { $addFields: { hourlyRateNum: { $toDouble: '$hourlyRate' } } },
          { $sort: { hourlyRateNum: sortDir, _id: -1 } },
          { $project: { hourlyRateNum: 0 } },
          ...(limitNum > 0 ? [{ $limit: limitNum }] : []),
        ];
        result = await roomCollection.aggregate(pipeline).toArray();
      } else {
        // Default / 'latest': newest first
        result = await roomCollection.find(query).sort({ _id: -1 }).limit(limitNum).toArray();
      }

      res.json(result);
    });



    app.post("/room", verifyToken, async (req, res) => {
      const roomData = req.body;
      const result = await roomCollection.insertOne(roomData);
      res.json(result);
    });


    app.get('/room/:id', async(req, res) => {
      const {id} = req.params
      const result = await roomCollection.findOne({_id: new ObjectId(id)})
      res.json(result)
    })


    app.patch("/room/:id", verifyToken, async (req, res) => {
      const {id}  =  req.params
      const updatedData = req.body
      const result = await roomCollection.updateOne(
        {_id: new ObjectId(id)},
        {$set: updatedData}
      )
      res.json(result)
    })


    app.delete('/room/:id', verifyToken, async (req, res) => {
      const {id} = req.params;
      const result = await roomCollection.deleteOne({_id: new ObjectId(id)})
      res.json(result)
    })



    app.get("/booking",  async (req, res) => {
      const { email } = req.query;
      const query = email ? { userEmail: email } : {};
      const result = await bookingCollection.find(query).sort({ date: -1 }).toArray();
      res.json(result);
    });

    app.post("/booking", verifyToken, async (req, res) => {
      const bookingData = req.body;
      const { roomId, date, startTime, endTime } = bookingData;

      // 1. Fetch existing non-cancelled bookings for this room on the same date
      const existingBookings = await bookingCollection.find({
        roomId,
        date,
        status: { $ne: 'cancelled' }
      }).toArray();

      // 2. Check for overlaps
      // Two time intervals [startA, endA) and [startB, endB) overlap if:
      // startA < endB AND endA > startB
      const isOverlapping = existingBookings.some(booking => {
        return startTime < booking.endTime && endTime > booking.startTime;
      });

      if (isOverlapping) {
        return res.status(400).json({
          error: "This room is already booked for the selected time slot. Please choose a different time."
        });
      }

      // 3. If no overlap, proceed with booking
      const result = await bookingCollection.insertOne(bookingData);
      
      // Increment booking count on the room
      await roomCollection.updateOne(
        { _id: new ObjectId(roomId) },
        { $inc: { bookingCount: 1 } }
      );

      res.json(result);
    });

    app.patch("/booking/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;
      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
      res.json(result);
    });

    app.delete("/booking/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const result = await bookingCollection.deleteOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    app.get("/booking/:userId", async (req, res) => {
      const {userId} = req.params
      const result = await bookingCollection.find({userId: userId}).toArray();
      res.json(result)
    })


    // Send  ping to confirm a successful connnection
    // comment this for deploy
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // sob somy aita comment korte hoybo
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("wlc farabi,s World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

module.exports = app;
