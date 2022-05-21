const express = require("express");
const cors = require("cors");
const app = express();
const jwt = require("jsonwebtoken");
require("dotenv").config();
const sgTransport = require("nodemailer-sendgrid-transport");
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello From Doctors Portal");
});

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const res = require("express/lib/response");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.q1cmm.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized Access" });
  } else {
    const accessToken = authHeader.split(" ")[1];
    jwt.verify(
      accessToken,
      process.env.ACCESS_TOKEN_SECRET,
      (error, decoded) => {
        if (error) {
          return res.status(403).send({ message: "Forbidden" });
        } else {
          req.decoded = decoded;
          next();
        }
      }
    );
  }
}

const emailSenderOptions = {
  auth: {
    api_key: process.env.EMAIL_SENDER_KEY,
  },
};

const emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));

function sendAppointmentEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking;

  var email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
    text: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
    html: `
      <div>
        <p> Hello ${patientName}, </p>
        <h3>Your Appointment for ${treatment} is confirmed</h3>
        <p>Looking forward to seeing you on ${date} at ${slot}.</p>
        
        <h3>Our Address</h3>
        <p>Andor Killa Bandorban</p>
        <p>Bangladesh</p>
        <a href="https://web.programming-hero.com/">unsubscribe</a>
      </div>
    `,
  };

  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Message sent: ", info);
    }
  });
}
function sendPaymentConfirmEmail(booking, transactionId) {
  const { patient, patientName, treatment, date, slot } = booking;

  var email = {
    from: process.env.EMAIL_SENDER,
    to: patient,
    subject: `We have received your payment for ${treatment} is on ${date} at ${slot} is confirmed.`,
    text: `Your payment for ${treatment} is on ${date} at ${slot} is Confirmed`,
    html: `
      <div>
        <p> Hello ${patientName}, </p>
        <h3>Your Appointment for your payment.</h3>
        <p>We have received your payment</p>
        <p>Looking forward to seeing you on ${date} at ${slot}.</p>

        <h3>TransactionId: ${transactionId}</h3>
        
        <h3>Our Address</h3>
        <p>Andor Killa Bandorban</p>
        <p>Bangladesh</p>
        <a href="https://web.programming-hero.com/">unsubscribe</a>
      </div>
    `,
  };

  emailClient.sendMail(email, function (err, info) {
    if (err) {
      console.log(err);
    } else {
      console.log("Message sent: ", info);
    }
  });
}

async function run() {
  try {
    await client.connect();
    console.log("Database Connected");
    const serviceCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");
    const userCollection = client.db("doctors_portal").collection("users");
    const doctorCollection = client.db("doctors_portal").collection("doctors");
    const paymentCollection = client
      .db("doctors_portal")
      .collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      } else {
        res.status(403).send({ message: "Forbidden" });
      }
    };

    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const service = req.body;
      const price = service.price;
      const amount = price * 100;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.patch("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const payment = req.body;
      const filter = { _id: ObjectId(id) };
      const updateDoc = {
        $set: {
          paid: true,
          transactionId: payment.transactionId,
        },
      };
      const result = await paymentCollection.insertOne(payment);
      const updatedBooking = await bookingCollection.updateOne(
        filter,
        updateDoc
      );
      const booking = await bookingCollection.findOne(filter);
      sendPaymentConfirmEmail(booking, payment.transactionId);
      res.send({ updatedBooking, result });
    });

    // API naming convention
    app.get("/service", async (req, res) => {
      const cursor = serviceCollection.find({}).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.get("/user", verifyJWT, async (req, res) => {
      const user = await userCollection.find({}).toArray();
      res.send(user);
    });

    app.get("/admin/:email", async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === "admin";
      res.send({ admin: isAdmin });
    });

    app.put("/user/admin/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updatedDoc = {
        $set: { role: "admin" },
      };
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updatedDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        {
          expiresIn: "1h",
        }
      );
      res.send({ result, token });
    });

    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const bookings = await bookingCollection
          .find({ patient: patient })
          .toArray();
        res.send(bookings);
      } else {
        return res.status(403).send("Forbidden Access");
      }
    });

    app.get("/booking/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const booking = await bookingCollection.findOne({ _id: ObjectId(id) });
      res.send(booking);
    });

    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);
      sendAppointmentEmail(booking);
      res.send({ success: true, result });
    });
    // warning
    // This is not the proper way to query
    // After learning more about mongodb. Use aggregate lookup, pipeline, match, group
    app.get("/available", async (req, res) => {
      const date = req.query.date || "May 14, 2022";
      // 1. get all services
      const services = await serviceCollection.find({}).toArray();
      // get the bookings of that day
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();
      // 3. For each service, find booking for that service
      services.forEach((service) => {
        const serviceBookings = bookings.filter(
          (b) => b.treatment === service.name
        );
        const bookedSlots = serviceBookings.map((book) => book.slot);
        const available = service.slots.filter((s) => !bookedSlots.includes(s));
        service.slots = available;
      });
      res.send(services);
    });
    app.get("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find({}).toArray();
      res.send(doctors);
    });
    app.post("/doctor", verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });
    app.delete("/doctor/:email", verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const result = await doctorCollection.deleteOne({ email: email });
      res.send(result);
    });
  } finally {
    // await client.close()
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Doctors Portal Is Running on port ${port}`);
});
