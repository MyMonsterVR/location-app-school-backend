const mongoose = require('mongoose');

const Connection = () => {
    const mongoURI = "mongodb+srv://username:password@cluster/?retryWrites=true&w=majority&appName=Cluster0"
    mongoose.connect(mongoURI)
        .then(() => {
            console.log('connected to db');
        })
        .catch((err) => {
            console.log(err);
        });
}

module.exports = Connection;
